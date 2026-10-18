// data.js

const APP_INFO = {
    title: "Zoombie Racing",
    version: "Version 1.0 - Halloween Edition",
    description: "Developed for Picket Piece Social Club. This is a real-time 3D Halloween monster racing simulation powered by Three.js and WebGL. Features include articulated 3D Zoombie characters and live telemetry tracking.",
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
        racers: ["Justin Bleeder", "Jack O'Chan", "King Tut Tut Tut", "Billy Bolts", "Boo Radley", "Hermione Danger", "Tyson Furry", "Bony Tyler"]
    },
    {
        id: "race_2",
        name: "Locksbridge Limbo",
        racers: ["Vlad the Inhaler", "Pump N'Grind", "Pharaoh Williams", "Boris Car-loff", "Sheet Faced", "Blair Twitch", "Hairy Potter", "Skelly Kelly"]
    },
    {
        id: "race_3",
        name: "Deadmouse Derby",
        racers: ["Blood Pitt", "Soup Erkins", "Mummy Mia", "Stitches Get Riches", "Ghost Malone", "Erma Creep", "Barking Mad", "The Bone Ranger"]
    },
    {
        id: "race_4",
        name: "Harroway Haunt",
        racers: ["Drac Black", "Gourd-on Ramsay", "Tomb Hanks", "Patchwork Pete", "Paranorman", "Wanda Rection", "Lycan Subscribe", "Deaddy Mercury"]
    },
    {
        id: "race_5",
        name: "Terror Valley Rally",
        racers: ["Count Down", "Patch Adams", "Gauze N' Roses", "Professor Green", "Ghoulia Roberts", "Witch and Famous", "Claw-dia Winkleman", "Indiana Bones"]
    },
    {
        id: "race_6",
        name: "Finkley Fright Night",
        racers: ["Fangs For Nothing", "Veg Ur Bets", "Curse-tian Bale", "Screw Loose", "Spectre Gadget", "Hagatha Christie", "Luna Tick", "Napoleon Bonesapart"]
    },
    {
        id: "race_7",
        name: "Harroway Hell",
        racers: ["Will Stake-speare", "Joe Squash", "Minnie the Sphinx", "Igor Beaver", "Kerri-fying", "Claire Voyant", "Mane Man", "Skull Dougery"]
    },
    {
        id: "race_8",
        name: "Lost Soul-cial Club Cup",
        racers: ["Batasha", "Butternut Stu", "Shaun the Shriek", "Odds N'Bens", "Hollow Hannah", "Hexy Becky", "Scarahhh Howlaway", "Craze Ann-atomy"]
    }
];
