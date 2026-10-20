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
            text.textContent = 'CONNECTED - PROJECTOR READY';
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
                break;

            case 'RACE_FINISHED':
                session = loadSessionData();
                renderAll();
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

            case 'FINISHED':
                badge.classList.add('badge-finished');
                mainBtn.textContent = 'LOAD NEXT RACE';
                mainBtn.className = 'btn btn-primary';
                mainBtn.disabled = false;
                editBtn.classList.add('hidden');
                break;
        }
    }

    function renderBettingTable() {
        const tbody = document.getElementById('betting-tbody');
        if (!tbody) return;

        const race = storedRaces[session.currentRaceIndex] || DEFAULT_RACES[0];
        const racerNames = race.racers || race.ducks || [];
        const calc = calculateToteDividends(session.currentBets, session.settings);

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
                    <input type="number" min="0" step="1" class="ticket-input" data-lane="${i}" value="${tickets}" ${isLocked ? 'disabled' : ''}>
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

        // Bind input events for ticket inputs
        const inputs = tbody.querySelectorAll('.ticket-input');
        inputs.forEach(inp => {
            inp.addEventListener('input', (e) => {
                const lane = parseInt(e.target.dataset.lane, 10);
                const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                session.currentBets[lane] = val;

                const newCalc = calculateToteDividends(session.currentBets, session.settings);
                session.currentDividends = newCalc.dividends;
                saveSessionData(session);

                // Update summary strip in real-time
                if (totalTicketsEl) totalTicketsEl.textContent = newCalc.totalTickets;
                if (grossPotEl) grossPotEl.textContent = `£${newCalc.grossPot.toFixed(2)}`;
                if (prizePoolEl) prizePoolEl.textContent = `£${newCalc.prizePool.toFixed(2)}`;
                if (clubSplitEl) clubSplitEl.textContent = `£${(newCalc.grossPot - newCalc.prizePool).toFixed(2)}`;

                // Update live columns across all rows
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
                } else if (state === 'SUBMITTED') {
                    // START RACE
                    session.toteState = 'RACING';
                    saveSessionData(session);

                    broadcastChannel.postMessage({ type: 'START_RACE' });
                    renderAll();
                } else if (state === 'FINISHED') {
                    // LOAD NEXT RACE
                    session.currentRaceIndex = (session.currentRaceIndex + 1) % storedRaces.length;
                    session.currentBets = [0, 0, 0, 0, 0, 0, 0, 0];
                    session.currentDividends = [0, 0, 0, 0, 0, 0, 0, 0];
                    session.betsSubmitted = false;
                    session.toteState = 'BETTING';
                    saveSessionData(session);

                    broadcastChannel.postMessage({ type: 'NEXT_RACE' });
                    renderAll();
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
                    ${deleteBtnHtml}
                </div>
            `;
            container.appendChild(card);
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
    // TAB 3: TOTE SETTINGS
    // ============================================
    function initSettings() {
        const ticketPriceInp = document.getElementById('setting-ticket-price');
        const prizeSplitInp = document.getElementById('setting-prize-split');
        const roundingStepSel = document.getElementById('setting-rounding-step');
        const saveMsg = document.getElementById('settings-save-msg');

        if (!ticketPriceInp || !prizeSplitInp || !roundingStepSel) return;

        const s = session.settings || DEFAULT_TOTE_SETTINGS;
        ticketPriceInp.value = (typeof s.ticketPrice === 'number') ? s.ticketPrice.toFixed(2) : '1.00';
        prizeSplitInp.value = (typeof s.prizeSplitPct === 'number') ? s.prizeSplitPct : 50;
        roundingStepSel.value = (typeof s.roundingStep === 'number') ? s.roundingStep.toFixed(2) : '0.50';

        const saveSettingsFromUI = () => {
            session.settings = {
                ticketPrice: Math.max(0.10, parseFloat(ticketPriceInp.value) || 1.00),
                prizeSplitPct: Math.max(10, Math.min(100, parseInt(prizeSplitInp.value, 10) || 50)),
                roundingStep: parseFloat(roundingStepSel.value) || 0.50
            };

            const calc = calculateToteDividends(session.currentBets, session.settings);
            session.currentDividends = calc.dividends;
            saveSessionData(session);

            if (saveMsg) {
                saveMsg.textContent = 'Settings auto-saved to active session.';
                saveMsg.style.opacity = '1';
                setTimeout(() => { saveMsg.style.opacity = '0.85'; }, 1500);
            }

            renderBettingTable();
        };

        ticketPriceInp.addEventListener('input', saveSettingsFromUI);
        prizeSplitInp.addEventListener('input', saveSettingsFromUI);
        roundingStepSel.addEventListener('change', saveSettingsFromUI);
    }

    // ============================================
    // CSV & XML EXPORT GENERATORS
    // ============================================
    function csvEscape(val) {
        if (val === null || val === undefined) return '';
        const s = String(val);
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    }

    function exportCSV() {
        const history = Array.isArray(session.history) ? session.history : [];
        const headers = [
            'Session ID',
            'Race Number',
            'Race Name',
            'Timestamp',
            'Ticket Price (£)',
            'Prize Split (%)',
            'Rounding Step (£)',
            'Lane 1 Tickets',
            'Lane 2 Tickets',
            'Lane 3 Tickets',
            'Lane 4 Tickets',
            'Lane 5 Tickets',
            'Lane 6 Tickets',
            'Lane 7 Tickets',
            'Lane 8 Tickets',
            'Total Tickets',
            'Gross Pot (£)',
            'Winner Lane',
            'Winner Name',
            'Winning Tickets',
            'Dividend Per Ticket (£)',
            'Total Paid Out (£)',
            'Net Club Profit (£)'
        ];

        const rows = [headers.join(',')];

        history.forEach(r => {
            const tickets = Array.isArray(r.ticketsByRacer) ? r.ticketsByRacer : [0,0,0,0,0,0,0,0];
            const row = [
                csvEscape(session.sessionId),
                csvEscape(r.raceNumber),
                csvEscape(r.raceName),
                csvEscape(r.timestamp),
                csvEscape((r.ticketPrice || 1.00).toFixed(2)),
                csvEscape(r.prizeSplitPct || 50),
                csvEscape((r.roundingStep || 0.50).toFixed(2)),
                csvEscape(tickets[0] || 0),
                csvEscape(tickets[1] || 0),
                csvEscape(tickets[2] || 0),
                csvEscape(tickets[3] || 0),
                csvEscape(tickets[4] || 0),
                csvEscape(tickets[5] || 0),
                csvEscape(tickets[6] || 0),
                csvEscape(tickets[7] || 0),
                csvEscape(r.totalTickets || 0),
                csvEscape((r.grossPot || 0).toFixed(2)),
                csvEscape(r.winnerId + 1),
                csvEscape(r.winnerName || ''),
                csvEscape(r.winningTickets || 0),
                csvEscape((r.dividendPerTicket || 0).toFixed(2)),
                csvEscape((r.totalPaidOut || 0).toFixed(2)),
                csvEscape((r.clubRetained || 0).toFixed(2))
            ];
            rows.push(row.join(','));
        });

        const csvContent = rows.join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zoombie-session-${session.sessionId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function xmlEscape(val) {
        if (val === null || val === undefined) return '';
        return String(val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function exportXML() {
        const history = Array.isArray(session.history) ? session.history : [];
        const s = session.settings || DEFAULT_TOTE_SETTINGS;

        let totalTicketsAll = 0;
        let totalGrossAll = 0;
        let totalPaidAll = 0;
        let totalProfitAll = 0;

        let racesXml = '';
        history.forEach(r => {
            totalTicketsAll += (r.totalTickets || 0);
            totalGrossAll += (r.grossPot || 0);
            totalPaidAll += (r.totalPaidOut || 0);
            totalProfitAll += (r.clubRetained || 0);

            const tickets = Array.isArray(r.ticketsByRacer) ? r.ticketsByRacer : [0,0,0,0,0,0,0,0];
            let lanesXml = '';
            for (let i = 0; i < 8; i++) {
                lanesXml += `        <Lane number="${i + 1}">${tickets[i] || 0}</Lane>\n`;
            }

            racesXml += `    <Race number="${r.raceNumber}" id="${xmlEscape(r.raceId)}">
      <Name>${xmlEscape(r.raceName)}</Name>
      <Timestamp>${xmlEscape(r.timestamp)}</Timestamp>
      <TicketPrice currency="GBP">${(r.ticketPrice || 1.00).toFixed(2)}</TicketPrice>
      <PrizeSplitPct>${r.prizeSplitPct || 50}</PrizeSplitPct>
      <RoundingStep currency="GBP">${(r.roundingStep || 0.50).toFixed(2)}</RoundingStep>
      <TotalTickets>${r.totalTickets || 0}</TotalTickets>
      <GrossPot currency="GBP">${(r.grossPot || 0).toFixed(2)}</GrossPot>
      <InitialPrizePool currency="GBP">${(r.initialPrizePool || 0).toFixed(2)}</InitialPrizePool>
      <Winner lane="${r.winnerId + 1}">${xmlEscape(r.winnerName || '')}</Winner>
      <WinningTickets>${r.winningTickets || 0}</WinningTickets>
      <DividendPerTicket currency="GBP">${(r.dividendPerTicket || 0).toFixed(2)}</DividendPerTicket>
      <TotalPaidOut currency="GBP">${(r.totalPaidOut || 0).toFixed(2)}</TotalPaidOut>
      <NetClubProfit currency="GBP">${(r.clubRetained || 0).toFixed(2)}</NetClubProfit>
      <TicketsByLane>
${lanesXml}      </TicketsByLane>
    </Race>\n`;
        });

        const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<ZoombieRacingSession id="${xmlEscape(session.sessionId)}">
  <ExportTimestamp>${new Date().toISOString()}</ExportTimestamp>
  <Settings>
    <TicketPrice currency="GBP">${(s.ticketPrice || 1.00).toFixed(2)}</TicketPrice>
    <PrizeSplitPct>${s.prizeSplitPct || 50}</PrizeSplitPct>
    <RoundingStep currency="GBP">${(s.roundingStep || 0.50).toFixed(2)}</RoundingStep>
  </Settings>
  <Races>
${racesXml}  </Races>
  <SessionTotals>
    <TotalCompletedRaces>${history.length}</TotalCompletedRaces>
    <TotalTickets>${totalTicketsAll}</TotalTickets>
    <TotalGrossPot currency="GBP">${totalGrossAll.toFixed(2)}</TotalGrossPot>
    <TotalPaidOut currency="GBP">${totalPaidAll.toFixed(2)}</TotalPaidOut>
    <TotalClubProfit currency="GBP">${totalProfitAll.toFixed(2)}</TotalClubProfit>
  </SessionTotals>
</ZoombieRacingSession>`;

        const blob = new Blob([xmlContent], { type: 'application/xml;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zoombie-session-${session.sessionId}.xml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function initHeaderActions() {
        const idEl = document.getElementById('admin-session-id');
        if (idEl) idEl.textContent = session.sessionId;

        const csvBtn = document.getElementById('export-csv-btn');
        if (csvBtn) csvBtn.addEventListener('click', exportCSV);

        const xmlBtn = document.getElementById('export-xml-btn');
        if (xmlBtn) xmlBtn.addEventListener('click', exportXML);

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
