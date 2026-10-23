// data.js

const APP_INFO = {
    title: "Zoombie Racing",
    version: "Version 1.1 - Halloween Edition",
    description: "Developed for Picket Piece Social Club. This is a real-time 3D Halloween monster racing simulation powered by Three.js and WebGL. Features include articulated 3D Zoombie characters, live telemetry tracking, and dual-screen tote betting.",
    credits: [
        {
            title: "Jack-o-lantern",
            url: "https://skfb.ly/pnNOJ",
            author: "Kroko.blend",
            license: "Creative Commons Attribution",
            licenseUrl: "http://creativecommons.org/licenses/by/4.0/"
        },
        {
            title: "Low poly Rocks",
            url: "https://skfb.ly/pwJCw",
            author: "Logan S.",
            license: "Creative Commons Attribution",
            licenseUrl: "http://creativecommons.org/licenses/by/4.0/"
        },
        {
            title: "Toon Tree 02",
            url: "https://skfb.ly/JL7F",
            author: "Sergio Sotomayor",
            license: "Creative Commons Attribution",
            licenseUrl: "http://creativecommons.org/licenses/by/4.0/"
        },
        {
            title: "Slime",
            url: "https://skfb.ly/orDYU",
            author: "ColinCharleson",
            license: "Creative Commons Attribution",
            licenseUrl: "http://creativecommons.org/licenses/by/4.0/"
        },
        {
            title: "Mario Leaf",
            url: "https://skfb.ly/opLXC",
            author: "Twisty_z",
            license: "Creative Commons Attribution",
            licenseUrl: "http://creativecommons.org/licenses/by/4.0/"
        },
        {
            title: "Animated Halloween Bat",
            url: "https://skfb.ly/oMMrS",
            author: "uosew",
            license: "Creative Commons Attribution",
            licenseUrl: "http://creativecommons.org/licenses/by/4.0/"
        }
    ],
    copyright: `© ${new Date().getFullYear()} Shaun Daubney. All rights reserved.`
};

const MONSTER_TYPES = [
    "Vampire",
    "Pumpkin",
    "Mummy",
    "Monster",
    "Ghost",
    "Witch",
    "Werewolf",
    "Skeleton"
];

const RACER_ASSETS = [
    { id: 0, name: "Vampire",  file: "models/vampire.glb" },
    { id: 1, name: "Pumpkin",  file: "models/pumpkin.glb" },
    { id: 2, name: "Mummy",    file: "models/mummy.glb" },
    { id: 3, name: "Monster",  file: "models/monster.glb" },
    { id: 4, name: "Ghost",    file: "models/ghost.glb" },
    { id: 5, name: "Witch",    file: "models/witch.glb" },
    { id: 6, name: "Werewolf", file: "models/werewolf.glb" },
    { id: 7, name: "Skeleton", file: "models/skeleton.glb" }
];

const DEFAULT_RACES = [
    {
        id: "race_1",
        name: "Walworth Wasteland",
        trackCurve: "s_curves",
        racers: ["Justin Bleeder", "Jack O'Chan", "King Tut Tut Tut", "Billy Bolts", "Boo Radley", "Hermione Danger", "Tyson Furry", "Bony Tyler"]
    },
    {
        id: "race_2",
        name: "Locksbridge Limbo",
        trackCurve: "s_curves",
        racers: ["Vlad the Inhaler", "Pump N'Grind", "Pharaoh Williams", "Boris Car-loff", "Sheet Faced", "Blair Twitch", "Hairy Potter", "Ned Skelly"]
    },
    {
        id: "race_3",
        name: "Deadmouse Derby",
        trackCurve: "s_curves",
        racers: ["Blood Pitt", "Soup Erkins", "Mummy Mia", "Stitches Get Riches", "Ghost Malone", "Erma Creep", "Barking Mad", "The Bone Ranger"]
    },
    {
        id: "race_4",
        name: "Harroway Haunt",
        trackCurve: "s_curves",
        racers: ["Drac Black", "Gourd-on Ramsay", "Tomb Hanks", "Patchwork Pete", "Paranorman", "Wanda Rection", "Lycan Subscribe", "Deaddy Mercury"]
    },
    {
        id: "race_5",
        name: "Terror Valley Rally",
        trackCurve: "s_curves",
        racers: ["Count Down", "Patch Adams", "Gauze N' Roses", "Professor Green", "Ghoulia Roberts", "Witch and Famous", "Claw-dia Winkleman", "Indiana Bones"]
    },
    {
        id: "race_6",
        name: "Finkley Fright Night",
        trackCurve: "s_curves",
        racers: ["Fangs For Nothing", "Veg Ur Bets", "Curse-tian Bale", "Screw Loose", "Spectre Gadget", "Hagatha Christie", "Luna Tick", "Napoleon Bonesapart"]
    },
    {
        id: "race_7",
        name: "Harroway Hell",
        trackCurve: "s_curves",
        racers: ["Will Stake-speare", "Joe Squash", "Minnie the Sphinx", "Igor Beaver", "Kerri-fying", "Claire Voyant", "Mane Man", "Skull Dougery"]
    },
    {
        id: "race_8",
        name: "Lost Soul-cial Club Cup",
        trackCurve: "s_curves",
        racers: ["Batasha", "Butternut Stu", "Shaun the Shriek", "Odds N'Bens", "Hollow Hannah", "Hexy Becky", "Scarahhh Howlaway", "Craze Ann-atomy"]
    }
];

// ============================================
// SHARED TOTE BETTING & SESSION MANAGEMENT
// ============================================
const SESSION_STORAGE_KEY = 'zoombieSession_v1';
const BROADCAST_CHANNEL_NAME = 'zoombie_race_channel';

const DEFAULT_TOTE_SETTINGS = {
    ticketPrice: 1.00,
    prizeSplitPct: 50,
    roundingStep: 0.50
};

/**
 * Generate a 6-digit session ID formatted as xxx-xxx (e.g. "482-919")
 */
function generateSessionId() {
    const part1 = Math.floor(100 + Math.random() * 900);
    const part2 = Math.floor(100 + Math.random() * 900);
    return `${part1}-${part2}`;
}

/**
 * Pure calculation helper for tote dividends.
 * Given tickets = [t0..t7] and settings = { ticketPrice, prizeSplitPct, roundingStep }:
 * 1. totalTickets = sum(tickets)
 * 2. grossPot = totalTickets * ticketPrice
 * 3. prizePool = grossPot * (prizeSplitPct / 100)
 * 4. For each racer i:
 *    - if tickets[i] <= 0 or prizePool <= 0: dividend[i] = 0
 *    - else rawDividend = prizePool / tickets[i]
 *    - if roundingStep > 0: round down to nearest step: Math.floor((rawDividend + 1e-9) / roundingStep) * roundingStep
 *    - else: Math.floor(rawDividend * 100) / 100
 */
function calculateToteDividends(tickets, settings) {
    const s = settings || DEFAULT_TOTE_SETTINGS;
    const ticketPrice = (typeof s.ticketPrice === 'number' && s.ticketPrice > 0) ? s.ticketPrice : 1.00;
    const prizeSplitPct = (typeof s.prizeSplitPct === 'number' && s.prizeSplitPct >= 0) ? s.prizeSplitPct : 50;
    const roundingStep = (typeof s.roundingStep === 'number' && s.roundingStep >= 0) ? s.roundingStep : 0.50;

    const ticketsArr = Array.isArray(tickets) ? tickets : [0, 0, 0, 0, 0, 0, 0, 0];
    const totalTickets = ticketsArr.reduce((sum, n) => sum + (parseInt(n, 10) || 0), 0);
    const grossPot = totalTickets * ticketPrice;
    const prizePool = grossPot * (prizeSplitPct / 100);

    const dividends = [];
    for (let i = 0; i < 8; i++) {
        const t = parseInt(ticketsArr[i], 10) || 0;
        if (t <= 0 || prizePool <= 0) {
            dividends.push(0);
        } else {
            const rawDividend = prizePool / t;
            let div;
            if (roundingStep > 0) {
                div = Math.floor((rawDividend + 1e-9) / roundingStep) * roundingStep;
            } else {
                div = Math.floor(rawDividend * 100) / 100;
            }
            dividends.push(Math.max(0, div));
        }
    }

    return {
        totalTickets,
        grossPot,
        prizePool,
        dividends
    };
}

/**
 * Load or initialise the active event session state from localStorage ('zoombieSession_v1').
 */
function loadSessionData() {
    try {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.sessionId) {
                if (!Array.isArray(parsed.currentBets) || parsed.currentBets.length !== 8) {
                    parsed.currentBets = [0, 0, 0, 0, 0, 0, 0, 0];
                }
                if (!Array.isArray(parsed.currentDividends) || parsed.currentDividends.length !== 8) {
                    parsed.currentDividends = [0, 0, 0, 0, 0, 0, 0, 0];
                }
                if (!Array.isArray(parsed.history)) {
                    parsed.history = [];
                }
                if (!parsed.settings) {
                    parsed.settings = { ...DEFAULT_TOTE_SETTINGS };
                }
                return parsed;
            }
        }
    } catch (e) {
        console.warn('Error reading zoombieSession_v1:', e);
    }

    // Default initial session
    const freshSession = {
        sessionId: generateSessionId(),
        currentRaceIndex: 0,
        toteState: "BETTING",
        settings: { ...DEFAULT_TOTE_SETTINGS },
        currentBets: [0, 0, 0, 0, 0, 0, 0, 0],
        currentDividends: [0, 0, 0, 0, 0, 0, 0, 0],
        betsSubmitted: false,
        history: []
    };
    saveSessionData(freshSession);
    return freshSession;
}

/**
 * Save active event session state to localStorage ('zoombieSession_v1').
 */
function saveSessionData(session) {
    try {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (e) {
        console.warn('Error saving zoombieSession_v1:', e);
    }
}

/**
 * Reset active event session to Race 1 with a new session ID, preserving settings & custom races.
 */
function resetSessionData() {
    const existing = loadSessionData();
    const preservedSettings = existing?.settings ? { ...existing.settings } : { ...DEFAULT_TOTE_SETTINGS };
    const freshSession = {
        sessionId: generateSessionId(),
        currentRaceIndex: 0,
        toteState: "BETTING",
        settings: preservedSettings,
        currentBets: [0, 0, 0, 0, 0, 0, 0, 0],
        currentDividends: [0, 0, 0, 0, 0, 0, 0, 0],
        betsSubmitted: false,
        history: []
    };
    saveSessionData(freshSession);
    return freshSession;
}

