// admin.js - Zoombie Racing Tote Betting & Control System
// UK English & GBP (£X.XX) formatting

(function() {
    'use strict';

    // Application state
    let session = loadSessionData();
    let storedRaces = [];
    const broadcastChannel = new BroadcastChannel(typeof BROADCAST_CHANNEL_NAME !== 'undefined' ? BROADCAST_CHANNEL_NAME : 'zoombie_race_channel');

    let lastProjectorHeartbeat = 0;
    let projectorIsReady = false;

    // File System Access API & Ledger state
    let ledgerFileHandle = null;
    let ledgerStatus = 'none'; // 'none' | 'saved' | 'saving' | 'pending' | 'error'
    let hasLedgerEverBeenCreated = false;

    // Lane colours matching 3D scene (Vampire, Pumpkin, Mummy, Monster, Ghost, Witch, Werewolf, Skeleton)
    const LANE_COLORS = [
        0xF42941, // Red
        0xE9862A, // Orange
        0xF0F136, // Yellow
        0x50C878, // Green
        0x00A8FF, // Blue
        0x9C27B0, // Purple
        0x607D8B, // Grey
        0xF3F5F7  // White
    ];

    function getLaneColor(idx) {
        const c = LANE_COLORS[idx] || 0xFFFFFF;
        const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
        const txt = (((r * 299) + (g * 587) + (b * 114)) / 1000) >= 128 ? '#000' : '#fff';
        return { hex: '#' + c.toString(16).padStart(6, '0'), text: txt };
    }

    // ============================================
    // ROSTER MANAGEMENT
    // ============================================
    function loadRosters() {
        const raw = localStorage.getItem('zoombieRaceData_v2');
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                const customRaces = Array.isArray(parsed) ? parsed.filter(r => r.id && String(r.id).startsWith('custom_')) : [];
                if (typeof DEFAULT_RACES !== 'undefined') {
                    storedRaces = JSON.parse(JSON.stringify(DEFAULT_RACES)).concat(customRaces);
                } else {
                    storedRaces = parsed;
                }
            } catch (e) {
                storedRaces = (typeof DEFAULT_RACES !== 'undefined') ? JSON.parse(JSON.stringify(DEFAULT_RACES)) : [];
            }
        } else if (typeof DEFAULT_RACES !== 'undefined') {
            storedRaces = JSON.parse(JSON.stringify(DEFAULT_RACES));
        } else {
            storedRaces = [];
        }
    }

    function saveRosters() {
        localStorage.setItem('zoombieRaceData_v2', JSON.stringify(storedRaces));
    }

    // ============================================
    // HEARTBEAT & PROJECTOR SYNC
    // ============================================
    function sendHeartbeat() {
        broadcastChannel.postMessage({ type: 'ADMIN_HEARTBEAT' });
    }

    function updateProjectorStatus() {
        const pill = document.getElementById('projector-status-pill');
        const text = document.getElementById('projector-status-text');
        if (!pill || !text) return;

        const isOnline = (Date.now() - lastProjectorHeartbeat < 4000);
        if (!isOnline) {
            pill.className = 'status-pill status-red';
            text.textContent = 'OFFLINE - OPEN INDEX.HTML';
        } else if (projectorIsReady) {
            pill.className = 'status-pill status-green';
            text.textContent = 'CONNECTED';
        } else {
            pill.className = 'status-pill status-amber';
            text.textContent = 'PROJECTOR LOADING...';
        }
    }

    broadcastChannel.onmessage = (event) => {
        const msg = event.data;
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'PROJECTOR_STATUS':
                lastProjectorHeartbeat = Date.now();
                projectorIsReady = Boolean(msg.ready);
                updateProjectorStatus();
                if (msg.raceState === 'FINISHED' && session.toteState !== 'FINISHED') {
                    session = loadSessionData();
                    renderAll();
                    triggerAutoSaveLedger();
                } else if (msg.raceState === 'READY' && session.toteState === 'RACING') {
                    session = loadSessionData();
                    renderAll();
                }
                break;

            case 'RACE_FINISHED':
                session = loadSessionData();
                renderAll();
                triggerAutoSaveLedger();
                break;

            case 'PROJECTOR_RACE_CHANGED':
                if (typeof msg.raceIndex === 'number') {
                    session = loadSessionData();
                    renderAll();
                }
                break;

            case 'SESSION_RESET':
                window.location.reload();
                break;
        }
    };

    window.addEventListener('beforeunload', () => {
        broadcastChannel.postMessage({ type: 'ADMIN_DISCONNECT' });
    });

    window.addEventListener('storage', (e) => {
        if (e.key === 'zoombieSession_v1') {
            session = loadSessionData();
            renderAll();
        }
    });

    // ============================================
    // NAVIGATION TABS
    // ============================================
    function initTabs() {
        const tabs = document.querySelectorAll('.nav-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

                tab.classList.add('active');
                const target = document.getElementById(`tab-${tab.dataset.tab}`);
                if (target) target.classList.add('active');
            });
        });
    }

    // ============================================
    // TAB 1: LIVE TOTE & CONTROL
    // ============================================
    function populateRaceDropdown() {
        const select = document.getElementById('admin-race-select');
        if (!select) return;
        select.innerHTML = '';
        storedRaces.forEach((race, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${idx + 1}. ${race.name}`;
            if (idx === session.currentRaceIndex) opt.selected = true;
            select.appendChild(opt);
        });
    }

    function renderToteControls() {
        const badge = document.getElementById('admin-tote-badge');
        const mainBtn = document.getElementById('main-action-btn');
        const editBtn = document.getElementById('edit-bets-btn');
        if (!badge || !mainBtn || !editBtn) return;

        const state = session.toteState || 'BETTING';
        badge.textContent = state;
        badge.className = 'state-badge';

        mainBtn.style.backgroundColor = '';
        mainBtn.style.color = '';
        mainBtn.style.borderColor = '';
        mainBtn.style.boxShadow = '';

        switch (state) {
            case 'BETTING':
                badge.classList.add('badge-betting');
                mainBtn.textContent = 'SUBMIT BETS TO SCREEN';
                mainBtn.className = 'btn btn-primary';
                mainBtn.disabled = false;
                editBtn.classList.add('hidden');
                break;

            case 'SUBMITTED':
                badge.classList.add('badge-submitted');
                mainBtn.textContent = 'START RACE';
                mainBtn.className = 'btn btn-success';
                mainBtn.disabled = false;
                editBtn.classList.remove('hidden');
                break;

            case 'RACING':
                badge.classList.add('badge-racing');
                mainBtn.textContent = 'RACE IN PROGRESS...';
                mainBtn.className = 'btn btn-secondary';
                mainBtn.disabled = true;
                editBtn.classList.add('hidden');
                break;

            case 'FINISHED': {
                badge.classList.add('badge-finished');
                badge.textContent = 'WINNER ANNOUNCED';
                mainBtn.textContent = 'NEXT RACE';
                mainBtn.className = 'btn btn-primary';
                mainBtn.disabled = false;
                editBtn.classList.add('hidden');
                const lastHistory = (session.history && session.history.length > 0)
                    ? session.history[session.history.length - 1]
                    : null;
                if (lastHistory && typeof lastHistory.winnerId === 'number' && typeof COLORS !== 'undefined') {
                    const winColor = COLORS[lastHistory.winnerId % COLORS.length];
                    const hexColor = '#' + winColor.toString(16).padStart(6, '0');
                    const r = (winColor >> 16) & 255, g = (winColor >> 8) & 255, b = winColor & 255;
                    const txtCol = (((r * 299) + (g * 587) + (b * 114)) / 1000) >= 128 ? '#000' : '#fff';
                    mainBtn.style.backgroundColor = hexColor;
                    mainBtn.style.color = txtCol;
                    mainBtn.style.borderColor = hexColor;
                    mainBtn.style.boxShadow = `0 4px 16px ${hexColor}66`;
                }
                break;
            }
        }
    }

    function renderBettingTable() {
        const tbody = document.getElementById('betting-tbody');
        if (!tbody) return;

        if (!Array.isArray(session.currentStartTickets) || session.currentStartTickets.length !== 8) {
            session.currentStartTickets = [1, 1, 1, 1, 1, 1, 1, 1];
        }
        if (!Array.isArray(session.currentNextTickets) || session.currentNextTickets.length !== 8) {
            session.currentNextTickets = [1, 1, 1, 1, 1, 1, 1, 1];
        }
        if (!Array.isArray(session.currentOverrides) || session.currentOverrides.length !== 8) {
            session.currentOverrides = [false, false, false, false, false, false, false, false];
        }
        if (!Array.isArray(session.currentBets) || session.currentBets.length !== 8) {
            session.currentBets = [0, 0, 0, 0, 0, 0, 0, 0];
        }

        const race = storedRaces[session.currentRaceIndex] || DEFAULT_RACES[0];
        const racerNames = race.racers || race.ducks || [];

        // Synchronise calculated tickets for non-overridden rows
        for (let i = 0; i < 8; i++) {
            if (!session.currentOverrides[i]) {
                const sT = parseInt(session.currentStartTickets[i], 10) || 0;
                const nT = parseInt(session.currentNextTickets[i], 10) || 0;
                session.currentBets[i] = Math.max(0, nT - sT);
            }
        }

        const calc = calculateToteDividends(session.currentBets, session.settings);
        session.currentDividends = calc.dividends;

        // Update Summary Strip
        const totalTicketsEl = document.getElementById('stat-total-tickets');
        const grossPotEl = document.getElementById('stat-gross-pot');
        const prizePoolEl = document.getElementById('stat-prize-pool');
        const clubSplitEl = document.getElementById('stat-club-split');

        if (totalTicketsEl) totalTicketsEl.textContent = calc.totalTickets;
        if (grossPotEl) grossPotEl.textContent = `£${calc.grossPot.toFixed(2)}`;
        if (prizePoolEl) prizePoolEl.textContent = `£${calc.prizePool.toFixed(2)}`;
        if (clubSplitEl) clubSplitEl.textContent = `£${(calc.grossPot - calc.prizePool).toFixed(2)}`;

        const isLocked = (session.toteState !== 'BETTING');
        const lastFinished = (session.toteState === 'FINISHED' && session.history.length > 0)
            ? session.history[session.history.length - 1]
            : null;

        tbody.innerHTML = '';
        for (let i = 0; i < 8; i++) {
            const tr = document.createElement('tr');
            if (lastFinished && lastFinished.winnerId === i) {
                tr.classList.add('winner-row');
            }

            const col = getLaneColor(i);
            const name = racerNames[i] || `Zoombie ${i + 1}`;
            const mType = (typeof MONSTER_TYPES !== 'undefined' && MONSTER_TYPES[i]) ? MONSTER_TYPES[i] : '';
            const sTicket = session.currentStartTickets[i];
            const nTicket = session.currentNextTickets[i];
            const isOverride = Boolean(session.currentOverrides[i]);
            const tickets = parseInt(session.currentBets[i], 10) || 0;
            const dividend = calc.dividends[i] || 0;
            const payout = tickets * dividend;
            const potentialClub = (calc.grossPot > 0) ? Math.max(0, calc.grossPot - payout) : 0;

            const divText = (tickets > 0 && dividend > 0)
                ? `<span class="dividend-val">£${dividend.toFixed(2)}</span>`
                : `<span class="dividend-val no-bets">NO BETS</span>`;

            tr.innerHTML = `
                <td>
                    <span class="lane-badge" style="background:${col.hex}; color:${col.text};">${i + 1}</span>
                </td>
                <td>
                    <div class="racer-cell">
                        <span class="racer-name">${name}</span>
                        <span class="racer-monster">${mType}</span>
                    </div>
                </td>
                <td>
                    <input type="number" min="0" step="1" class="ticket-num-input start-ticket-input" data-lane="${i}" value="${sTicket}" ${isLocked ? 'disabled' : ''}>
                </td>
                <td>
                    <input type="number" min="0" step="1" class="ticket-num-input next-ticket-input" data-lane="${i}" value="${nTicket}" ${isLocked ? 'disabled' : ''}>
                </td>
                <td style="text-align: center;">
                    <div class="ticket-override-wrap">
                        <input type="checkbox" class="ticket-override-cb" data-lane="${i}" ${isOverride ? 'checked' : ''} ${isLocked ? 'disabled' : ''} title="Manual ticket override">
                    </div>
                </td>
                <td>
                    <input type="number" min="0" step="1" class="ticket-num-input ticket-input" data-lane="${i}" value="${tickets}" ${isLocked || !isOverride ? 'readonly' : ''} ${isLocked ? 'disabled' : ''}>
                </td>
                <td id="cell-div-${i}">
                    ${divText}
                </td>
                <td id="cell-pay-${i}">
                    £${payout.toFixed(2)}
                </td>
                <td id="cell-club-${i}">
                    £${potentialClub.toFixed(2)}
                </td>
            `;
            tbody.appendChild(tr);
        }

        // Live recalculation helper across all rows
        function updateLiveCalculations() {
            const newCalc = calculateToteDividends(session.currentBets, session.settings);
            session.currentDividends = newCalc.dividends;
            saveSessionData(session);
            markLedgerPending();

            if (totalTicketsEl) totalTicketsEl.textContent = newCalc.totalTickets;
            if (grossPotEl) grossPotEl.textContent = `£${newCalc.grossPot.toFixed(2)}`;
            if (prizePoolEl) prizePoolEl.textContent = `£${newCalc.prizePool.toFixed(2)}`;
            if (clubSplitEl) clubSplitEl.textContent = `£${(newCalc.grossPot - newCalc.prizePool).toFixed(2)}`;

            for (let k = 0; k < 8; k++) {
                const t = parseInt(session.currentBets[k], 10) || 0;
                const d = newCalc.dividends[k] || 0;
                const p = t * d;
                const c = (newCalc.grossPot > 0) ? Math.max(0, newCalc.grossPot - p) : 0;

                const cellDiv = document.getElementById(`cell-div-${k}`);
                const cellPay = document.getElementById(`cell-pay-${k}`);
                const cellClub = document.getElementById(`cell-club-${k}`);

                if (cellDiv) {
                    cellDiv.innerHTML = (t > 0 && d > 0)
                        ? `<span class="dividend-val">£${d.toFixed(2)}</span>`
                        : `<span class="dividend-val no-bets">NO BETS</span>`;
                }
                if (cellPay) cellPay.textContent = `£${p.toFixed(2)}`;
                if (cellClub) cellClub.textContent = `£${c.toFixed(2)}`;
            }
        }

        // Bind Start Ticket Inputs
        tbody.querySelectorAll('.start-ticket-input').forEach(inp => {
            inp.addEventListener('input', (e) => {
                const lane = parseInt(e.target.dataset.lane, 10);
                const sVal = Math.max(0, parseInt(e.target.value, 10) || 0);
                session.currentStartTickets[lane] = sVal;

                if (!session.currentOverrides[lane]) {
                    const nVal = parseInt(session.currentNextTickets[lane], 10) || 0;
                    const sold = Math.max(0, nVal - sVal);
                    session.currentBets[lane] = sold;
                    const ticketInput = tbody.querySelector(`.ticket-input[data-lane="${lane}"]`);
                    if (ticketInput) ticketInput.value = sold;
                }
                updateLiveCalculations();
            });
        });

        // Bind Next Ticket Inputs
        tbody.querySelectorAll('.next-ticket-input').forEach(inp => {
            inp.addEventListener('input', (e) => {
                const lane = parseInt(e.target.dataset.lane, 10);
                const nVal = Math.max(0, parseInt(e.target.value, 10) || 0);
                session.currentNextTickets[lane] = nVal;

                if (!session.currentOverrides[lane]) {
                    const sVal = parseInt(session.currentStartTickets[lane], 10) || 0;
                    const sold = Math.max(0, nVal - sVal);
                    session.currentBets[lane] = sold;
                    const ticketInput = tbody.querySelector(`.ticket-input[data-lane="${lane}"]`);
                    if (ticketInput) ticketInput.value = sold;
                }
                updateLiveCalculations();
            });
        });

        // Bind Override Checkboxes
        tbody.querySelectorAll('.ticket-override-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const lane = parseInt(e.target.dataset.lane, 10);
                const isOver = e.target.checked;
                session.currentOverrides[lane] = isOver;

                const ticketInput = tbody.querySelector(`.ticket-input[data-lane="${lane}"]`);
                if (ticketInput) {
                    if (isOver) {
                        ticketInput.removeAttribute('readonly');
                        ticketInput.focus();
                        ticketInput.select();
                    } else {
                        ticketInput.setAttribute('readonly', 'true');
                        const sVal = parseInt(session.currentStartTickets[lane], 10) || 0;
                        const nVal = parseInt(session.currentNextTickets[lane], 10) || 0;
                        const sold = Math.max(0, nVal - sVal);
                        session.currentBets[lane] = sold;
                        ticketInput.value = sold;
                    }
                }
                updateLiveCalculations();
            });
        });

        // Bind Manual Tickets Sold Input (when override is checked)
        tbody.querySelectorAll('.ticket-input').forEach(inp => {
            inp.addEventListener('input', (e) => {
                const lane = parseInt(e.target.dataset.lane, 10);
                if (session.currentOverrides[lane]) {
                    const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                    session.currentBets[lane] = val;
                    updateLiveCalculations();
                }
            });
        });
    }

    function renderHistoryTable() {
        const tbody = document.getElementById('history-tbody');
        const tfoot = document.getElementById('history-tfoot');
        const countEl = document.getElementById('history-count');
        if (!tbody || !tfoot) return;

        const history = Array.isArray(session.history) ? session.history : [];
        if (countEl) countEl.textContent = `${history.length} Completed Race${history.length === 1 ? '' : 's'}`;

        if (history.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="empty-history">No completed races in this session yet. Races will appear here once finished.</td></tr>`;
            tfoot.innerHTML = '';
            return;
        }

        let sumTickets = 0;
        let sumGross = 0;
        let sumPaidOut = 0;
        let sumClubProfit = 0;

        tbody.innerHTML = '';
        history.forEach(r => {
            sumTickets += (r.totalTickets || 0);
            sumGross += (r.grossPot || 0);
            sumPaidOut += (r.totalPaidOut || 0);
            sumClubProfit += (r.clubRetained || 0);

            const ticketsBreakdown = Array.isArray(r.ticketsByRacer)
                ? r.ticketsByRacer.join(', ')
                : '-';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>#${r.raceNumber}</strong></td>
                <td>${r.raceName}</td>
                <td><small style="color: #bbb;">[${ticketsBreakdown}]</small></td>
                <td><strong>${r.totalTickets}</strong></td>
                <td>£${(r.grossPot || 0).toFixed(2)}</td>
                <td><span style="color: var(--broadcast-ecto); font-weight: bold;">#${r.winnerId + 1} ${r.winnerName}</span></td>
                <td>${r.winningTickets}</td>
                <td>£${(r.dividendPerTicket || 0).toFixed(2)}</td>
                <td>£${(r.totalPaidOut || 0).toFixed(2)}</td>
                <td><strong style="color: #e1bee7;">£${(r.clubRetained || 0).toFixed(2)}</strong></td>
            `;
            tbody.appendChild(tr);
        });

        tfoot.innerHTML = `
            <tr>
                <td colspan="3"><strong>SESSION TOTALS</strong></td>
                <td><strong>${sumTickets}</strong></td>
                <td><strong>£${sumGross.toFixed(2)}</strong></td>
                <td colspan="3"></td>
                <td><strong>£${sumPaidOut.toFixed(2)}</strong></td>
                <td><strong style="color: var(--broadcast-ecto); font-size: 1.15rem;">£${sumClubProfit.toFixed(2)}</strong></td>
            </tr>
        `;
    }

    function initLiveToteControls() {
        const raceSelect = document.getElementById('admin-race-select');
        if (raceSelect) {
            raceSelect.addEventListener('change', (e) => {
                session.currentRaceIndex = parseInt(e.target.value, 10);
                session.currentBets = [0, 0, 0, 0, 0, 0, 0, 0];
                session.currentDividends = [0, 0, 0, 0, 0, 0, 0, 0];
                session.betsSubmitted = false;
                session.toteState = 'BETTING';
                saveSessionData(session);

                broadcastChannel.postMessage({
                    type: 'SELECT_RACE',
                    raceIndex: session.currentRaceIndex
                });
                renderAll();
            });
        }

        const mainBtn = document.getElementById('main-action-btn');
        if (mainBtn) {
            mainBtn.addEventListener('click', () => {
                const state = session.toteState || 'BETTING';

                if (state === 'BETTING') {
                    // SUBMIT BETS TO SCREEN
                    const calc = calculateToteDividends(session.currentBets, session.settings);
                    session.currentDividends = calc.dividends;
                    session.betsSubmitted = true;
                    session.toteState = 'SUBMITTED';
                    saveSessionData(session);

                    broadcastChannel.postMessage({
                        type: 'BETS_SUBMITTED',
                        raceIndex: session.currentRaceIndex
                    });
                    renderAll();
                    triggerAutoSaveLedger();
                } else if (state === 'SUBMITTED') {
                    // START RACE
                    session.toteState = 'RACING';
                    saveSessionData(session);

                    broadcastChannel.postMessage({ type: 'START_RACE' });
                    renderAll();
                } else if (state === 'FINISHED') {
                    // NEXT RACE - progress projector and advance session
                    broadcastChannel.postMessage({ type: 'NEXT_RACE' });

                    const nextStartTickets = session.currentNextTickets ? [...session.currentNextTickets] : [1, 1, 1, 1, 1, 1, 1, 1];
                    session.currentRaceIndex = (session.currentRaceIndex + 1) % storedRaces.length;
                    session.currentStartTickets = nextStartTickets;
                    session.currentNextTickets = [...nextStartTickets];
                    session.currentOverrides = [false, false, false, false, false, false, false, false];
                    session.currentBets = [0, 0, 0, 0, 0, 0, 0, 0];
                    session.currentDividends = [0, 0, 0, 0, 0, 0, 0, 0];
                    session.betsSubmitted = false;
                    session.toteState = 'BETTING';
                    saveSessionData(session);
                    renderAll();
                    markLedgerPending();
                }
            });
        }

        const editBtn = document.getElementById('edit-bets-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                session.betsSubmitted = false;
                session.toteState = 'BETTING';
                saveSessionData(session);

                broadcastChannel.postMessage({
                    type: 'BETS_SUBMITTED',
                    raceIndex: session.currentRaceIndex
                });
                renderAll();
            });
        }
    }

    // ============================================
    // TAB 2: MANAGE RACES
    // ============================================
    function renderRosterList() {
        const container = document.getElementById('roster-list');
        if (!container) return;
        container.innerHTML = '';

        storedRaces.forEach((race, idx) => {
            const card = document.createElement('div');
            card.className = 'roster-card';

            const isCustom = race.id && String(race.id).startsWith('custom_');
            const racerNames = race.racers || race.ducks || [];

            const racersListHtml = racerNames.map((name, i) => {
                const col = getLaneColor(i);
                return `<li><span style="display:inline-block;width:12px;height:12px;background:${col.hex};border-radius:2px;vertical-align:middle;margin-right:6px;"></span>#${i + 1} ${name}</li>`;
            }).join('');

            const exportBtnHtml = isCustom
                ? `<button class="btn-export-race" data-idx="${idx}">EXPORT EVENT</button>`
                : '';
            const deleteBtnHtml = isCustom
                ? `<button class="btn-delete-race" data-idx="${idx}">DELETE</button>`
                : '';

            card.innerHTML = `
                <div class="roster-card-header">
                    <span class="roster-title">${idx + 1}. ${race.name}</span>
                    <span class="roster-tag ${isCustom ? 'custom' : ''}">${isCustom ? 'CUSTOM' : 'DEFAULT'}</span>
                </div>
                <ul class="roster-racers">
                    ${racersListHtml}
                </ul>
                <div class="roster-actions">
                    ${exportBtnHtml}
                    ${deleteBtnHtml}
                </div>
            `;
            container.appendChild(card);
        });

        // Bind export event buttons for custom races
        container.querySelectorAll('.btn-export-race').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.idx, 10);
                const targetRace = storedRaces[idx];
                if (!targetRace) return;

                const exportObj = {
                    version: "1.0",
                    id: targetRace.id,
                    name: targetRace.name,
                    trackCurve: targetRace.trackCurve || 's_curves',
                    racers: targetRace.racers || targetRace.ducks || []
                };

                const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const safeName = (targetRace.name || 'race').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                a.download = `zoombie-event-${safeName}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });
        });

        // Bind delete buttons
        container.querySelectorAll('.btn-delete-race').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.idx, 10);
                const targetRace = storedRaces[idx];
                if (!targetRace) return;

                if (confirm(`Delete custom race "${targetRace.name}"?`)) {
                    storedRaces.splice(idx, 1);
                    saveRosters();

                    if (session.currentRaceIndex >= storedRaces.length) {
                        session.currentRaceIndex = 0;
                        saveSessionData(session);
                    }

                    broadcastChannel.postMessage({ type: 'ROSTER_UPDATED' });
                    renderAll();
                }
            });
        });
    }

    function initRacerInputGrid() {
        const grid = document.getElementById('racer-input-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const types = (typeof MONSTER_TYPES !== 'undefined') ? MONSTER_TYPES : [];

        for (let i = 0; i < 8; i++) {
            const col = getLaneColor(i);
            const mType = types[i] || `Monster ${i + 1}`;
            const div = document.createElement('div');
            div.className = 'lane-input-item';
            div.innerHTML = `
                <span class="lane-badge" style="background:${col.hex}; color:${col.text};">${i + 1}</span>
                <input type="text" id="custom-racer-${i}" placeholder="Lane #${i + 1} (${mType})" required>
            `;
            grid.appendChild(div);
        }
    }

    function initManageRaces() {
        initRacerInputGrid();

        // Import Event handler
        const importEventBtn = document.getElementById('import-event-btn');
        const importEventInput = document.getElementById('import-event-input');

        if (importEventBtn && importEventInput) {
            importEventBtn.addEventListener('click', () => {
                importEventInput.value = '';
                importEventInput.click();
            });

            importEventInput.addEventListener('change', (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const rawText = String(ev.target.result || '').trim();
                        let parsed = null;
                        try {
                            parsed = JSON.parse(rawText);
                        } catch (err) {
                            // Fallback to simple CSV parsing
                            const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 0);
                            if (lines.length > 0) {
                                const parts = lines[0].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
                                if (parts.length >= 2) {
                                    parsed = {
                                        name: parts[0],
                                        racers: parts.slice(1, 9)
                                    };
                                }
                            }
                        }

                        if (!parsed) throw new Error('Could not parse event file');

                        const eventsToAdd = Array.isArray(parsed) ? parsed : [parsed];
                        let count = 0;

                        eventsToAdd.forEach((item, itemIdx) => {
                            const name = (item.name || item.raceName || `Imported Event ${storedRaces.length + 1}`).trim();
                            let racers = Array.isArray(item.racers) ? item.racers : (Array.isArray(item.ducks) ? item.ducks : []);
                            racers = racers.map(r => String(r).trim()).filter(Boolean);

                            while (racers.length < 8) {
                                racers.push(`Zoombie ${racers.length + 1}`);
                            }
                            racers = racers.slice(0, 8);

                            const newRace = {
                                id: 'custom_' + Date.now() + '_' + itemIdx,
                                name: name,
                                trackCurve: item.trackCurve || 's_curves',
                                racers: racers,
                                ducks: racers
                            };

                            storedRaces.push(newRace);
                            count++;
                        });

                        saveRosters();
                        broadcastChannel.postMessage({ type: 'ROSTER_UPDATED' });
                        renderAll();
                        alert(`Successfully imported ${count} event${count === 1 ? '' : 's'}!`);
                    } catch (err) {
                        console.error('Error importing event:', err);
                        alert('Failed to import event. Please ensure the file is valid JSON or CSV with event name and racer names.');
                    }
                };
                reader.readAsText(file);
            });
        }

        const form = document.getElementById('create-race-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const eventName = document.getElementById('new-event-name').value.trim() || 'Untitled Haunt';
                const names = [];
                for (let i = 0; i < 8; i++) {
                    const val = document.getElementById(`custom-racer-${i}`).value.trim();
                    names.push(val || `Zoombie ${i + 1}`);
                }

                const newRace = {
                    id: 'custom_' + Date.now(),
                    name: eventName,
                    trackCurve: 's_curves',
                    racers: names,
                    ducks: names
                };

                storedRaces.push(newRace);
                saveRosters();

                broadcastChannel.postMessage({ type: 'ROSTER_UPDATED' });

                form.reset();
                renderAll();
                alert(`Race "${eventName}" saved successfully!`);
            });
        }

        const resetBtn = document.getElementById('reset-rosters-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm("Reset all race rosters back to default Halloween races? This will delete all custom events.")) {
                    localStorage.removeItem('zoombieRaceData_v2');
                    loadRosters();
                    if (session.currentRaceIndex >= storedRaces.length) {
                        session.currentRaceIndex = 0;
                        saveSessionData(session);
                    }
                    broadcastChannel.postMessage({ type: 'ROSTER_UPDATED' });
                    renderAll();
                    alert("Race rosters reset to defaults.");
                }
            });
        }
    }

    // ============================================
    // TAB 3: TOTE SETTINGS & TAB 4: OTHER SETTINGS
    // ============================================
    function initSettings() {
        const floatInp = document.getElementById('setting-starting-float');
        const ticketPriceInp = document.getElementById('setting-ticket-price');
        const prizeSplitInp = document.getElementById('setting-prize-split');
        const roundingStepSel = document.getElementById('setting-rounding-step');
        const saveMsg = document.getElementById('settings-save-msg');

        // Other Settings Elements
        const masterMuteCb = document.getElementById('setting-master-mute');
        const muteStatusLabel = document.getElementById('mute-status-label');
        const engineVolumeSel = document.getElementById('setting-engine-volume');
        const impactVolumeSel = document.getElementById('setting-impact-volume');
        const announcerVolumeSel = document.getElementById('setting-announcer-volume');
        const hazardDensitySel = document.getElementById('setting-hazard-density');
        const simulationSpeedSel = document.getElementById('setting-simulation-speed');
        const remoteFullscreenBtn = document.getElementById('btn-remote-fullscreen');
        const otherSaveMsg = document.getElementById('other-settings-save-msg');

        if (!ticketPriceInp || !prizeSplitInp || !roundingStepSel) return;

        const s = session.settings || DEFAULT_TOTE_SETTINGS;
        if (floatInp) {
            floatInp.value = (typeof s.startingFloat === 'number') ? s.startingFloat.toFixed(2) : '0.00';
        }
        ticketPriceInp.value = (typeof s.ticketPrice === 'number') ? s.ticketPrice.toFixed(2) : '1.00';
        prizeSplitInp.value = (typeof s.prizeSplitPct === 'number') ? s.prizeSplitPct : 50;
        roundingStepSel.value = (typeof s.roundingStep === 'number') ? s.roundingStep.toFixed(2) : '0.50';

        // Populate Other Settings
        if (masterMuteCb) {
            masterMuteCb.checked = Boolean(s.masterMute);
            if (muteStatusLabel) {
                muteStatusLabel.textContent = s.masterMute ? 'Muted (All Projector Sound Silenced)' : 'Unmuted (Normal Sound)';
                muteStatusLabel.style.color = s.masterMute ? 'var(--broadcast-red)' : 'var(--broadcast-text)';
            }
        }
        if (engineVolumeSel) {
            engineVolumeSel.value = (typeof s.engineVolume === 'number') ? String(s.engineVolume) : '100';
        }
        if (impactVolumeSel) {
            impactVolumeSel.value = (typeof s.impactVolume === 'number') ? String(s.impactVolume) : '100';
        }
        if (announcerVolumeSel) {
            announcerVolumeSel.value = (typeof s.announcerVolume === 'number') ? String(s.announcerVolume) : '100';
        }
        if (hazardDensitySel) {
            hazardDensitySel.value = s.hazardDensity || 'normal';
        }
        if (simulationSpeedSel) {
            simulationSpeedSel.value = (typeof s.simulationSpeed === 'number') ? String(s.simulationSpeed) : '1.0';
        }

        const saveSettingsFromUI = () => {
            session.settings = {
                ...(session.settings || DEFAULT_TOTE_SETTINGS),
                startingFloat: floatInp ? Math.max(0, parseFloat(floatInp.value) || 0) : 0.00,
                ticketPrice: Math.max(0.10, parseFloat(ticketPriceInp.value) || 1.00),
                prizeSplitPct: Math.max(10, Math.min(100, parseInt(prizeSplitInp.value, 10) || 50)),
                roundingStep: parseFloat(roundingStepSel.value) || 0.50
            };

            const calc = calculateToteDividends(session.currentBets, session.settings);
            session.currentDividends = calc.dividends;
            saveSessionData(session);
            markLedgerPending();

            if (saveMsg) {
                saveMsg.textContent = 'Settings auto-saved to active session.';
                saveMsg.style.opacity = '1';
                setTimeout(() => { saveMsg.style.opacity = '0.85'; }, 1500);
            }

            renderBettingTable();
        };

        const saveOtherSettingsFromUI = () => {
            const isMuted = masterMuteCb ? masterMuteCb.checked : false;
            const engVol = engineVolumeSel ? parseInt(engineVolumeSel.value, 10) : 100;
            const impVol = impactVolumeSel ? parseInt(impactVolumeSel.value, 10) : 100;
            const annVol = announcerVolumeSel ? parseInt(announcerVolumeSel.value, 10) : 100;
            const hazDen = hazardDensitySel ? hazardDensitySel.value : 'normal';
            const simSpd = simulationSpeedSel ? parseFloat(simulationSpeedSel.value) : 1.0;

            if (muteStatusLabel) {
                muteStatusLabel.textContent = isMuted ? 'Muted (All Projector Sound Silenced)' : 'Unmuted (Normal Sound)';
                muteStatusLabel.style.color = isMuted ? 'var(--broadcast-red)' : 'var(--broadcast-text)';
            }

            session.settings = {
                ...(session.settings || DEFAULT_TOTE_SETTINGS),
                masterMute: isMuted,
                engineVolume: engVol,
                impactVolume: impVol,
                announcerVolume: annVol,
                hazardDensity: hazDen,
                simulationSpeed: simSpd
            };

            saveSessionData(session);
            if (typeof savePersistentOtherSettings === 'function') {
                savePersistentOtherSettings(session.settings);
            }
            markLedgerPending();

            broadcastChannel.postMessage({
                type: 'OTHER_SETTINGS_UPDATED',
                settings: session.settings
            });

            if (otherSaveMsg) {
                otherSaveMsg.textContent = 'Settings auto-saved to active session.';
                otherSaveMsg.style.opacity = '1';
                setTimeout(() => { otherSaveMsg.style.opacity = '0.85'; }, 1500);
            }
        };

        if (floatInp) floatInp.addEventListener('input', saveSettingsFromUI);
        ticketPriceInp.addEventListener('input', saveSettingsFromUI);
        prizeSplitInp.addEventListener('input', saveSettingsFromUI);
        roundingStepSel.addEventListener('change', saveSettingsFromUI);

        if (masterMuteCb) masterMuteCb.addEventListener('change', saveOtherSettingsFromUI);
        if (engineVolumeSel) engineVolumeSel.addEventListener('change', saveOtherSettingsFromUI);
        if (impactVolumeSel) impactVolumeSel.addEventListener('change', saveOtherSettingsFromUI);
        if (announcerVolumeSel) announcerVolumeSel.addEventListener('change', saveOtherSettingsFromUI);
        if (hazardDensitySel) hazardDensitySel.addEventListener('change', saveOtherSettingsFromUI);
        if (simulationSpeedSel) simulationSpeedSel.addEventListener('change', saveOtherSettingsFromUI);

        if (remoteFullscreenBtn) {
            remoteFullscreenBtn.addEventListener('click', () => {
                broadcastChannel.postMessage({ type: 'TOGGLE_FULLSCREEN' });
                remoteFullscreenBtn.textContent = 'COMMAND SENT!';
                setTimeout(() => { remoteFullscreenBtn.textContent = 'TOGGLE FULLSCREEN'; }, 1200);
            });
        }
    }

    // ============================================
    // LEDGER STATUS & CSV SYSTEM
    // ============================================
    function csvEscape(val) {
        if (val === null || val === undefined) return '';
        const s = String(val);
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    }

    function setLedgerStatus(status) {
        ledgerStatus = status;
        const mainBtn = document.getElementById('ledger-main-btn');
        const textEl = document.getElementById('ledger-status-text');
        if (!mainBtn || !textEl) return;

        mainBtn.classList.remove('ledger-state-none', 'ledger-state-saved', 'ledger-state-pending', 'ledger-state-saving', 'ledger-state-error');

        switch (status) {
            case 'saved':
                mainBtn.classList.add('ledger-state-saved');
                textEl.textContent = 'LEDGER SAVED';
                break;
            case 'saving':
                mainBtn.classList.add('ledger-state-saving');
                textEl.textContent = 'LEDGER SAVING...';
                break;
            case 'pending':
                mainBtn.classList.add('ledger-state-pending');
                textEl.textContent = 'LEDGER PENDING';
                break;
            case 'error':
                mainBtn.classList.add('ledger-state-error');
                textEl.textContent = 'LEDGER ERROR';
                break;
            case 'none':
            default:
                mainBtn.classList.add('ledger-state-none');
                textEl.textContent = 'CREATE LEDGER';
                break;
        }
    }

    function markLedgerPending() {
        if (hasLedgerEverBeenCreated && ledgerStatus !== 'saving') {
            setLedgerStatus('pending');
        }
    }

    function triggerAutoSaveLedger() {
        if (ledgerFileHandle) {
            writeLedgerFile();
        } else if (hasLedgerEverBeenCreated) {
            setLedgerStatus('pending');
        }
    }

    function generateLedgerCSV() {
        const history = Array.isArray(session.history) ? session.history : [];
        const s = session.settings || DEFAULT_TOTE_SETTINGS;
        const startingFloat = Number(s.startingFloat) || 0.00;

        let sumTickets = 0;
        let sumGross = 0;
        let sumPaidOut = 0;
        let sumClubProfit = 0;

        history.forEach(r => {
            sumTickets += (r.totalTickets || 0);
            sumGross += (r.grossPot || 0);
            sumPaidOut += (r.totalPaidOut || 0);
            sumClubProfit += (r.clubRetained || 0);
        });

        const closingFloat = startingFloat + sumClubProfit;
        const nowIso = new Date().toISOString();

        const lines = [
            `# ZOOMBIE RACING TOTE LEDGER`,
            `# VERSION: 2.0`,
            `# SESSION_ID: ${session.sessionId}`,
            `# GENERATED_AT: ${nowIso}`,
            `# STARTING_FLOAT: ${startingFloat.toFixed(2)}`,
            `# CLOSING_FLOAT: ${closingFloat.toFixed(2)}`,
            `# TICKET_PRICE: ${(s.ticketPrice || 1.00).toFixed(2)}`,
            `# PRIZE_SPLIT_PCT: ${s.prizeSplitPct || 50}`,
            `# ROUNDING_STEP: ${(s.roundingStep || 0.50).toFixed(2)}`,
            `# ENGINE_VOLUME: ${s.engineVolume ?? 100}`,
            `# IMPACT_VOLUME: ${s.impactVolume ?? 100}`,
            `# ANNOUNCER_VOLUME: ${s.announcerVolume ?? 100}`,
            `# MASTER_MUTE: ${s.masterMute ? '1' : '0'}`,
            `# HAZARD_DENSITY: ${s.hazardDensity || 'normal'}`,
            `# SIMULATION_SPEED: ${s.simulationSpeed ?? 1.0}`,
            `# COMPLETED_RACES_COUNT: ${history.length}`,
            `# TOTAL_TICKETS_SOLD: ${sumTickets}`,
            `# TOTAL_GROSS_POT: ${sumGross.toFixed(2)}`,
            `# TOTAL_PAID_OUT: ${sumPaidOut.toFixed(2)}`,
            `# TOTAL_NET_PROFIT: ${sumClubProfit.toFixed(2)}`,
            ``,
            `[SESSION SUMMARY]`,
            `Property,Value`,
            `Session ID,${csvEscape(session.sessionId)}`,
            `Export Timestamp,${csvEscape(nowIso)}`,
            `Starting Float (£),${startingFloat.toFixed(2)}`,
            `Closing Float (£),${closingFloat.toFixed(2)}`,
            `Ticket Price (£),${(s.ticketPrice || 1.00).toFixed(2)}`,
            `Prize Split (%),${s.prizeSplitPct || 50}%`,
            `Dividend Rounding Rule (£),${(s.roundingStep || 0.50).toFixed(2)}`,
            `Master Mute (PA Mode),${s.masterMute ? 'YES' : 'NO'}`,
            `Engine Volume (%),${s.engineVolume ?? 100}%`,
            `Impact Volume (%),${s.impactVolume ?? 100}%`,
            `Announcer & Fanfare Volume (%),${s.announcerVolume ?? 100}%`,
            `Hazard Density,${s.hazardDensity || 'normal'}`,
            `Simulation Speed,${s.simulationSpeed ?? 1.0}x`,
            `Total Races Completed,${history.length}`,
            `Total Tickets Sold,${sumTickets}`,
            `Total Gross Pot (£),${sumGross.toFixed(2)}`,
            `Total Paid Out (£),${sumPaidOut.toFixed(2)}`,
            `Total Net Club Profit (£),${sumClubProfit.toFixed(2)}`,
            ``,
            `[COMPLETED RACES]`,
            `Race #,Race ID,Race Name,Timestamp,Ticket Price (£),Prize Split (%),Rounding Step (£),Total Tickets,Gross Pot (£),Winner Lane,Winner Name,Winning Tickets,Dividend Per Ticket (£),Total Paid Out (£),Net Club Profit (£),Start Tickets (L1-8),Next Tickets (L1-8),Overrides (L1-8),Tickets Sold (L1-8)`
        ];

        history.forEach(r => {
            const tickets = Array.isArray(r.ticketsByRacer) ? r.ticketsByRacer : [0,0,0,0,0,0,0,0];
            const startT = Array.isArray(r.startTicketsByRacer) ? r.startTicketsByRacer : [1,1,1,1,1,1,1,1];
            const nextT = Array.isArray(r.nextTicketsByRacer) ? r.nextTicketsByRacer : [1,1,1,1,1,1,1,1];
            const overT = Array.isArray(r.overridesByRacer) ? r.overridesByRacer : [false,false,false,false,false,false,false,false];

            lines.push([
                csvEscape(r.raceNumber),
                csvEscape(r.raceId || ''),
                csvEscape(r.raceName || ''),
                csvEscape(r.timestamp || ''),
                csvEscape((r.ticketPrice || 1.00).toFixed(2)),
                csvEscape(r.prizeSplitPct || 50),
                csvEscape((r.roundingStep || 0.50).toFixed(2)),
                csvEscape(r.totalTickets || 0),
                csvEscape((r.grossPot || 0).toFixed(2)),
                csvEscape(r.winnerId != null ? (r.winnerId + 1) : ''),
                csvEscape(r.winnerName || ''),
                csvEscape(r.winningTickets || 0),
                csvEscape((r.dividendPerTicket || 0).toFixed(2)),
                csvEscape((r.totalPaidOut || 0).toFixed(2)),
                csvEscape((r.clubRetained || 0).toFixed(2)),
                csvEscape(startT.join(';')),
                csvEscape(nextT.join(';')),
                csvEscape(overT.map(v => v ? '1' : '0').join(';')),
                csvEscape(tickets.join(';'))
            ].join(','));
        });

        // Active Race Details
        const activeRace = storedRaces[session.currentRaceIndex] || DEFAULT_RACES[0] || { name: 'Active Race' };
        const activeCalc = calculateToteDividends(session.currentBets, session.settings);
        const activeNames = activeRace.racers || activeRace.ducks || [];

        lines.push('');
        lines.push('[CURRENT RACE]');
        lines.push('Active Race Index,Active Race Name,Tote Status,Gross Pot (£),Target Prize Pool (£),Base Club Split (£)');
        lines.push([
            csvEscape(session.currentRaceIndex + 1),
            csvEscape(activeRace.name),
            csvEscape(session.toteState || 'BETTING'),
            csvEscape(activeCalc.grossPot.toFixed(2)),
            csvEscape(activeCalc.prizePool.toFixed(2)),
            csvEscape((activeCalc.grossPot - activeCalc.prizePool).toFixed(2))
        ].join(','));

        lines.push('');
        lines.push('[CURRENT RACE LANES]');
        lines.push('Lane #,Racer Name,Monster Type,Starting Ticket,Next Ticket,Override Active,Tickets Sold,Dividend (£),Total Payout (£),Club Cut (£)');

        for (let lane = 0; lane < 8; lane++) {
            const mType = (typeof MONSTER_TYPES !== 'undefined' && MONSTER_TYPES[lane]) ? MONSTER_TYPES[lane] : '';
            const t = parseInt(session.currentBets[lane], 10) || 0;
            const d = activeCalc.dividends[lane] || 0;
            const p = t * d;
            const c = (activeCalc.grossPot > 0) ? Math.max(0, activeCalc.grossPot - p) : 0;
            const sT = session.currentStartTickets?.[lane] ?? 1;
            const nT = session.currentNextTickets?.[lane] ?? 1;
            const isO = session.currentOverrides?.[lane] ? 'YES' : 'NO';

            lines.push([
                lane + 1,
                csvEscape(activeNames[lane] || `Zoombie ${lane + 1}`),
                csvEscape(mType),
                csvEscape(sT),
                csvEscape(nT),
                isO,
                t,
                csvEscape(d.toFixed(2)),
                csvEscape(p.toFixed(2)),
                csvEscape(c.toFixed(2))
            ].join(','));
        }

        return lines.join('\r\n');
    }

    async function createLedger(replace = false) {
        if (typeof window.showSaveFilePicker === 'function') {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: `zoombie-ledger-session-${session.sessionId}.csv`,
                    types: [{
                        description: 'CSV Tote Ledger',
                        accept: { 'text/csv': ['.csv'] }
                    }]
                });
                ledgerFileHandle = handle;
                hasLedgerEverBeenCreated = true;
                await writeLedgerFile();
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Error selecting ledger file:', err);
                    setLedgerStatus('error');
                    alert('Could not create ledger file: ' + err.message);
                }
            }
        } else {
            // Safari / browsers without File System Access API
            hasLedgerEverBeenCreated = true;
            downloadLedgerCSV();
            setLedgerStatus('saved');
            alert('Session ledger generated and downloaded!\n\nNote: Safari does not support direct background file sync, but you can export or replace your ledger anytime.');
        }
    }

    async function writeLedgerFile() {
        if (!ledgerFileHandle) {
            if (hasLedgerEverBeenCreated) {
                downloadLedgerCSV();
                setLedgerStatus('saved');
            }
            return;
        }

        try {
            setLedgerStatus('saving');
            const csvContent = generateLedgerCSV();
            const writable = await ledgerFileHandle.createWritable();
            await writable.write(csvContent);
            await writable.close();
            setLedgerStatus('saved');
        } catch (err) {
            console.error('Error writing ledger to file:', err);
            setLedgerStatus('error');
        }
    }

    function downloadLedgerCSV() {
        const csvContent = generateLedgerCSV();
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zoombie-ledger-session-${session.sessionId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importLedger(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = String(e.target.result || '').trim();
                let imported = null;

                // Try JSON import first
                if (content.startsWith('{')) {
                    imported = JSON.parse(content);
                } else {
                    // Parse CSV Ledger
                    const lines = content.split(/\r?\n/);
                    const meta = {};
                    lines.forEach(l => {
                        const trimmed = l.trim();
                        if (trimmed.startsWith('#')) {
                            const match = trimmed.match(/^#\s*([A-Z0-9_]+)\s*:\s*(.*)$/i);
                            if (match) {
                                meta[match[1].toUpperCase()] = match[2].trim();
                            }
                        }
                    });

                    if (meta.SESSION_ID) {
                        const restoredHistory = [];
                        let inCompleted = false;
                        let inLanes = false;
                        const restoredStartTickets = [1,1,1,1,1,1,1,1];
                        const restoredNextTickets = [1,1,1,1,1,1,1,1];
                        const restoredOverrides = [false,false,false,false,false,false,false,false];
                        const restoredBets = [0,0,0,0,0,0,0,0];

                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i].trim();
                            if (line === '[COMPLETED RACES]') {
                                inCompleted = true;
                                inLanes = false;
                                continue;
                            } else if (line === '[CURRENT RACE LANES]') {
                                inCompleted = false;
                                inLanes = true;
                                continue;
                            } else if (line.startsWith('[') && line.endsWith(']')) {
                                inCompleted = false;
                                inLanes = false;
                                continue;
                            }

                            if (inCompleted && line && !line.startsWith('Race #')) {
                                const parts = line.split(',');
                                if (parts.length >= 15) {
                                    const rNum = parseInt(parts[0], 10) || 1;
                                    const rId = parts[1] || `race_${rNum}`;
                                    const rName = parts[2] || `Race ${rNum}`;
                                    const time = parts[3] || '';
                                    const tPrice = parseFloat(parts[4]) || 1.00;
                                    const split = parseInt(parts[5], 10) || 50;
                                    const rStep = parseFloat(parts[6]) || 0.50;
                                    const tTickets = parseInt(parts[7], 10) || 0;
                                    const gross = parseFloat(parts[8]) || 0;
                                    const winLane = (parseInt(parts[9], 10) || 1) - 1;
                                    const winName = parts[10] || '';
                                    const winTickets = parseInt(parts[11], 10) || 0;
                                    const divPaid = parseFloat(parts[12]) || 0;
                                    const paidOut = parseFloat(parts[13]) || 0;
                                    const profit = parseFloat(parts[14]) || 0;

                                    const parseSemiNums = (str) => (str ? str.replace(/^"|"$/g, '').split(';').map(n => parseInt(n, 10) || 0) : [0,0,0,0,0,0,0,0]);
                                    const startArr = parseSemiNums(parts[15]);
                                    const nextArr = parseSemiNums(parts[16]);
                                    const overArr = (parts[17] ? parts[17].replace(/^"|"$/g, '').split(';').map(n => n === '1') : [false,false,false,false,false,false,false,false]);
                                    const betsArr = parseSemiNums(parts[18]);

                                    restoredHistory.push({
                                        raceNumber: rNum,
                                        raceId: rId,
                                        raceName: rName,
                                        timestamp: time,
                                        ticketPrice: tPrice,
                                        prizeSplitPct: split,
                                        roundingStep: rStep,
                                        ticketsByRacer: betsArr,
                                        startTicketsByRacer: startArr,
                                        nextTicketsByRacer: nextArr,
                                        overridesByRacer: overArr,
                                        totalTickets: tTickets,
                                        grossPot: gross,
                                        initialPrizePool: gross * (split / 100),
                                        winnerId: winLane,
                                        winnerName: winName,
                                        winningTickets: winTickets,
                                        dividendPerTicket: divPaid,
                                        totalPaidOut: paidOut,
                                        clubRetained: profit
                                    });
                                }
                            } else if (inLanes && line && !line.startsWith('Lane #')) {
                                const parts = line.split(',');
                                if (parts.length >= 7) {
                                    const laneIdx = (parseInt(parts[0], 10) || 1) - 1;
                                    if (laneIdx >= 0 && laneIdx < 8) {
                                        restoredStartTickets[laneIdx] = parseInt(parts[3], 10) || 1;
                                        restoredNextTickets[laneIdx] = parseInt(parts[4], 10) || 1;
                                        restoredOverrides[laneIdx] = (parts[5] && parts[5].toUpperCase() === 'YES');
                                        restoredBets[laneIdx] = parseInt(parts[6], 10) || 0;
                                    }
                                }
                            }
                        }

                        imported = {
                            sessionId: meta.SESSION_ID,
                            currentRaceIndex: 0,
                            toteState: 'BETTING',
                            settings: {
                                startingFloat: parseFloat(meta.STARTING_FLOAT) || 0.00,
                                ticketPrice: parseFloat(meta.TICKET_PRICE) || 1.00,
                                prizeSplitPct: parseInt(meta.PRIZE_SPLIT_PCT, 10) || 50,
                                roundingStep: parseFloat(meta.ROUNDING_STEP) || 0.50,
                                engineVolume: meta.ENGINE_VOLUME != null ? parseInt(meta.ENGINE_VOLUME, 10) : (session.settings?.engineVolume ?? 100),
                                impactVolume: meta.IMPACT_VOLUME != null ? parseInt(meta.IMPACT_VOLUME, 10) : (session.settings?.impactVolume ?? 100),
                                announcerVolume: meta.ANNOUNCER_VOLUME != null ? parseInt(meta.ANNOUNCER_VOLUME, 10) : (session.settings?.announcerVolume ?? 100),
                                masterMute: meta.MASTER_MUTE === '1' || meta.MASTER_MUTE === 'true',
                                hazardDensity: ['high', 'normal', 'low', 'disabled'].includes(meta.HAZARD_DENSITY) ? meta.HAZARD_DENSITY : (session.settings?.hazardDensity ?? 'normal'),
                                simulationSpeed: meta.SIMULATION_SPEED != null ? parseFloat(meta.SIMULATION_SPEED) : (session.settings?.simulationSpeed ?? 1.0)
                            },
                            currentStartTickets: restoredStartTickets,
                            currentNextTickets: restoredNextTickets,
                            currentOverrides: restoredOverrides,
                            currentBets: restoredBets,
                            currentDividends: [0, 0, 0, 0, 0, 0, 0, 0],
                            betsSubmitted: false,
                            history: restoredHistory
                        };
                    }
                }

                if (!imported || !imported.sessionId) {
                    throw new Error('Unrecognised ledger format or missing Session ID');
                }

                session = imported;
                saveSessionData(session);
                hasLedgerEverBeenCreated = true;
                setLedgerStatus('pending');

                broadcastChannel.postMessage({
                    type: 'PROJECTOR_RACE_CHANGED',
                    raceIndex: session.currentRaceIndex
                });
                broadcastChannel.postMessage({ type: 'ROSTER_UPDATED' });

                renderAll();
                alert(`Session ${session.sessionId} ledger successfully imported with ${session.history.length} completed race${session.history.length === 1 ? '' : 's'}!`);
            } catch (err) {
                console.error('Error importing ledger:', err);
                alert('Could not import ledger: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    // ============================================
    // XLSX EXPORT GENERATOR
    // ============================================
    function exportXLSX() {
        if (typeof XLSX === 'undefined') {
            alert('XLSX engine not loaded. Downloading CSV ledger instead.');
            downloadLedgerCSV();
            return;
        }

        const history = Array.isArray(session.history) ? session.history : [];
        const s = session.settings || DEFAULT_TOTE_SETTINGS;
        const startingFloat = Number(s.startingFloat) || 0.00;

        let sumTickets = 0;
        let sumGross = 0;
        let sumPaidOut = 0;
        let sumClubProfit = 0;

        history.forEach(r => {
            sumTickets += (r.totalTickets || 0);
            sumGross += (r.grossPot || 0);
            sumPaidOut += (r.totalPaidOut || 0);
            sumClubProfit += (r.clubRetained || 0);
        });

        const closingFloat = startingFloat + sumClubProfit;
        const wb = XLSX.utils.book_new();

        // Sheet 1: Session Summary
        const summaryData = [
            ["ZOOMBIE RACING - SESSION LEDGER"],
            [""],
            ["Session ID", session.sessionId],
            ["Generated", new Date().toLocaleString('en-GB')],
            ["Starting Float (£)", startingFloat],
            ["Closing Float (£)", closingFloat],
            ["Ticket Price (£)", Number(s.ticketPrice) || 1.00],
            ["Prize Split (%)", Number(s.prizeSplitPct) || 50],
            ["Dividend Rounding Rule (£)", Number(s.roundingStep) || 0.50],
            ["Master Mute (PA Mode)", s.masterMute ? "YES" : "NO"],
            ["Engine Volume (%)", Number(s.engineVolume) || 100],
            ["Impact Volume (%)", Number(s.impactVolume) || 100],
            ["Announcer & Fanfare Volume (%)", Number(s.announcerVolume) || 100],
            ["Hazard Density", s.hazardDensity || "normal"],
            ["Simulation Speed", `${Number(s.simulationSpeed) || 1.0}x`],
            [""],
            ["FINANCIAL TOTALS", ""],
            ["Total Completed Races", history.length],
            ["Total Tickets Sold", sumTickets],
            ["Total Gross Pot (£)", sumGross],
            ["Total Paid Out (£)", sumPaidOut],
            ["Total Net Club Profit (£)", sumClubProfit]
        ];
        const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, "Session Summary");

        // Sheet 2: Completed Races
        const completedData = [
            [
                "Race #", "Race Name", "Finished Timestamp", "Winner Lane", "Winner Name",
                "Winning Tickets", "Dividend (£)", "Gross Pot (£)", "Total Paid Out (£)",
                "Net Club Profit (£)", "Total Tickets",
                "L1 Sold", "L2 Sold", "L3 Sold", "L4 Sold", "L5 Sold", "L6 Sold", "L7 Sold", "L8 Sold"
            ]
        ];

        history.forEach(r => {
            const t = Array.isArray(r.ticketsByRacer) ? r.ticketsByRacer : [0,0,0,0,0,0,0,0];
            completedData.push([
                r.raceNumber,
                r.raceName,
                r.timestamp,
                (r.winnerId != null ? r.winnerId + 1 : ""),
                r.winnerName || "",
                r.winningTickets || 0,
                r.dividendPerTicket || 0,
                r.grossPot || 0,
                r.totalPaidOut || 0,
                r.clubRetained || 0,
                r.totalTickets || 0,
                t[0] || 0, t[1] || 0, t[2] || 0, t[3] || 0, t[4] || 0, t[5] || 0, t[6] || 0, t[7] || 0
            ]);
        });

        // Totals row
        completedData.push([
            "TOTALS", "", "", "", "", "", "",
            sumGross, sumPaidOut, sumClubProfit, sumTickets,
            "", "", "", "", "", "", "", ""
        ]);
        const wsCompleted = XLSX.utils.aoa_to_sheet(completedData);
        XLSX.utils.book_append_sheet(wb, wsCompleted, "Completed Races");

        // Sheet 3: Lane Breakdown
        const breakdownData = [
            [
                "Race #", "Race Name", "Lane #", "Racer Name", "Monster",
                "Starting Ticket", "Next Ticket", "Tickets Sold", "Dividend (£)", "Total Payout (£)", "Club Cut (£)"
            ]
        ];

        history.forEach(r => {
            const raceConfig = storedRaces.find(sr => sr.name === r.raceName) || {};
            const rNames = raceConfig.racers || raceConfig.ducks || [];
            const startT = Array.isArray(r.startTicketsByRacer) ? r.startTicketsByRacer : [];
            const nextT = Array.isArray(r.nextTicketsByRacer) ? r.nextTicketsByRacer : [];
            const tickets = Array.isArray(r.ticketsByRacer) ? r.ticketsByRacer : [];

            for (let lane = 0; lane < 8; lane++) {
                const laneSold = tickets[lane] || 0;
                const isWinner = (r.winnerId === lane);
                const payout = isWinner ? (r.totalPaidOut || 0) : 0;
                const mType = (typeof MONSTER_TYPES !== 'undefined' && MONSTER_TYPES[lane]) ? MONSTER_TYPES[lane] : '';
                breakdownData.push([
                    r.raceNumber,
                    r.raceName,
                    lane + 1,
                    rNames[lane] || (isWinner ? r.winnerName : `Zoombie ${lane + 1}`),
                    mType,
                    startT[lane] ?? "",
                    nextT[lane] ?? "",
                    laneSold,
                    isWinner ? (r.dividendPerTicket || 0) : 0,
                    payout,
                    (r.grossPot || 0) - payout
                ]);
            }
        });
        const wsBreakdown = XLSX.utils.aoa_to_sheet(breakdownData);
        XLSX.utils.book_append_sheet(wb, wsBreakdown, "Lane Breakdown");

        // Sheet 4: Active Race
        const activeRace = storedRaces[session.currentRaceIndex] || DEFAULT_RACES[0] || { name: 'Active Race' };
        const activeNames = activeRace.racers || activeRace.ducks || [];
        const activeCalc = calculateToteDividends(session.currentBets, session.settings);
        const activeData = [
            ["Active Race Index", session.currentRaceIndex + 1],
            ["Active Race Name", activeRace.name],
            ["Tote Status", session.toteState || "BETTING"],
            ["Gross Pot (£)", activeCalc.grossPot],
            ["Target Prize Pool (£)", activeCalc.prizePool],
            ["Base Club Split (£)", activeCalc.grossPot - activeCalc.prizePool],
            [""],
            [
                "Lane #", "Racer Name", "Monster", "Starting Ticket", "Next Ticket",
                "Override Used", "Tickets Sold", "Dividend (£)", "Total Payout (£)", "Club Cut (£)"
            ]
        ];

        for (let lane = 0; lane < 8; lane++) {
            const mType = (typeof MONSTER_TYPES !== 'undefined' && MONSTER_TYPES[lane]) ? MONSTER_TYPES[lane] : '';
            const t = parseInt(session.currentBets[lane], 10) || 0;
            const d = activeCalc.dividends[lane] || 0;
            const p = t * d;
            const c = (activeCalc.grossPot > 0) ? Math.max(0, activeCalc.grossPot - p) : 0;
            activeData.push([
                lane + 1,
                activeNames[lane] || `Zoombie ${lane + 1}`,
                mType,
                session.currentStartTickets?.[lane] ?? 1,
                session.currentNextTickets?.[lane] ?? 1,
                session.currentOverrides?.[lane] ? "Yes" : "No",
                t,
                d,
                p,
                c
            ]);
        }
        const wsActive = XLSX.utils.aoa_to_sheet(activeData);
        XLSX.utils.book_append_sheet(wb, wsActive, "Active Race");

        XLSX.writeFile(wb, `zoombie-session-${session.sessionId}.xlsx`);
    }

    // ============================================
    // HEADER ACTIONS
    // ============================================
    function initHeaderActions() {
        const idEl = document.getElementById('admin-session-id');
        if (idEl) idEl.textContent = session.sessionId;

        // Ledger combo button controls
        const ledgerMainBtn = document.getElementById('ledger-main-btn');
        const ledgerMenuToggle = document.getElementById('ledger-menu-toggle-btn');
        const ledgerDropdownMenu = document.getElementById('ledger-dropdown-menu');
        const ledgerSaveNowBtn = document.getElementById('ledger-save-now-btn');
        const ledgerReplaceBtn = document.getElementById('ledger-replace-btn');
        const ledgerImportBtn = document.getElementById('ledger-import-btn');
        const ledgerDownloadBtn = document.getElementById('ledger-download-btn');
        const ledgerImportInput = document.getElementById('ledger-file-import-input');

        if (ledgerMainBtn) {
            ledgerMainBtn.addEventListener('click', () => {
                if (!ledgerFileHandle && !hasLedgerEverBeenCreated) {
                    createLedger(false);
                } else {
                    writeLedgerFile();
                }
            });
        }

        if (ledgerMenuToggle && ledgerDropdownMenu) {
            ledgerMenuToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                ledgerDropdownMenu.classList.toggle('hidden');
            });

            document.addEventListener('click', (e) => {
                if (!ledgerDropdownMenu.classList.contains('hidden') && !ledgerDropdownMenu.contains(e.target)) {
                    ledgerDropdownMenu.classList.add('hidden');
                }
            });
        }

        if (ledgerSaveNowBtn) {
            ledgerSaveNowBtn.addEventListener('click', () => {
                if (ledgerDropdownMenu) ledgerDropdownMenu.classList.add('hidden');
                writeLedgerFile();
            });
        }

        if (ledgerReplaceBtn) {
            ledgerReplaceBtn.addEventListener('click', () => {
                if (ledgerDropdownMenu) ledgerDropdownMenu.classList.add('hidden');
                createLedger(true);
            });
        }

        if (ledgerImportBtn && ledgerImportInput) {
            ledgerImportBtn.addEventListener('click', () => {
                if (ledgerDropdownMenu) ledgerDropdownMenu.classList.add('hidden');
                ledgerImportInput.value = '';
                ledgerImportInput.click();
            });

            ledgerImportInput.addEventListener('change', (e) => {
                const file = e.target.files?.[0];
                if (file) importLedger(file);
            });
        }

        if (ledgerDownloadBtn) {
            ledgerDownloadBtn.addEventListener('click', () => {
                if (ledgerDropdownMenu) ledgerDropdownMenu.classList.add('hidden');
                downloadLedgerCSV();
            });
        }

        // Export XLSX button
        const exportXlsxBtn = document.getElementById('export-xlsx-btn');
        if (exportXlsxBtn) {
            exportXlsxBtn.addEventListener('click', exportXLSX);
        }

        // New Session button
        const newSessionBtn = document.getElementById('new-session-btn');
        if (newSessionBtn) {
            newSessionBtn.addEventListener('click', () => {
                if (confirm("Start a new session? This will clear all current betting history and reset both screens to Race 1.")) {
                    resetSessionData();
                    broadcastChannel.postMessage({ type: 'SESSION_RESET' });
                    window.location.reload();
                }
            });
        }
    }

    // ============================================
    // MASTER RENDER
    // ============================================
    function renderAll() {
        populateRaceDropdown();
        renderToteControls();
        renderBettingTable();
        renderHistoryTable();
        renderRosterList();
    }

    // Initialisation
    loadRosters();
    initHeaderActions();
    initTabs();
    initLiveToteControls();
    initManageRaces();
    initSettings();
    renderAll();

    // Heartbeat timers
    sendHeartbeat();
    setInterval(sendHeartbeat, 1500);
    setInterval(updateProjectorStatus, 1000);

})();
