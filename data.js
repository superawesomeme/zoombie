// data.js

const APP_INFO = {
    title: "Zoombie Racing Simulator",
    version: "Version 1.0 - Halloween Edition",
    description: "Developed for Picket Piece Social Club. This is a real-time 3D Halloween monster racing simulation powered by Three.js and WebGL. Features include articulated 3D Zoombie characters, a moonlit haunted road, custom event management, and live telemetry tracking.",
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
        name: "Walworth Werewolf Dash",
        ducks: ["Count Fangula", "Jack O'Lantern", "King Tut-ankh-rot", "Franken-Sprint", "Banshee Bolt", "Hexa Wicked", "Wolfie Howler", "Grim Bonez"]
    },
    {
        id: "race_2",
        name: "Locksbridge Lich Lunge",
        ducks: ["Vlad the Impaler", "Gourd Almighty", "Wraps McGee", "Bolt Neck", "Phantom Phred", "Blair Twitch", "Hairy Trotter", "Skelly Kelly"]
    },
    {
        id: "race_3",
        name: "Deadmouse Derby",
        ducks: ["Nosferatu Express", "Smashing Pumpkin", "Mummy Mia", "Brainz Yanic", "Polter-Guy", "Cauldron Carl", "Barking Mad", "Ribcage Roy"]
    },
    {
        id: "race_4",
        name: "Harroway Haunt",
        ducks: ["Drac Black", "Peter Pumpkin", "Bandage Bob", "Stitch Up", "Wailing Wanda", "Hocus Pocus", "Moon Moon", "Femur Mercury"]
    },
    {
        id: "race_5",
        name: "Terror Valley Rally",
        ducks: ["Bela Lugosi", "Patch Adams", "Cleo-Rot-ra", "Green Mean", "Ghoulia Roberts", "Sabrina Spell", "Sir Growls-a-Lot", "Indiana Bones"]
    },
    {
        id: "race_6",
        name: "Finkley Fright Night",
        ducks: ["Alucard", "Candle Jack", "Imhotep Step", "Lurching Lou", "Spectre Gadget", "Endora Dash", "Fenrir Fast", "Napoleon Boned"]
    },
    {
        id: "race_7",
        name: "Hellhound Highway",
        ducks: ["Lestat LeZoom", "Harvest Horror", "Sphinxter", "Igor Beaver", "Casper Creep", "Bellatrix", "Silver Bullet", "Skull Dugggery"]
    },
    {
        id: "race_8",
        name: "Spooky Club Cup",
        ducks: ["Baron Blood", "Turnip Terror", "Pharaoh Fright", "Zomb-Boy", "Ecto-Blaster", "Broomstick Bill", "Picket Prowler", "Rattle & Hum"]
    }
];