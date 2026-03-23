// Game constants
export const ARENA_SIZE = 400;
export const ARENA_HALF = ARENA_SIZE / 2;
export const ARENA_RADIUS = 190; // fixed circular boundary

export const TERRAIN_SEGMENTS = 128;
export const TERRAIN_HEIGHT_SCALE = 3.5;
export const TERRAIN_NOISE_SCALE = 0.05;

export const SERPENT_BASE_SPEED = 7;
export const SERPENT_BOOST_SPEED = 14;
export const SERPENT_TURN_SPEED = 2.8; // radians/sec
export const SERPENT_BOOST_TURN_SPEED = 2.2;
export const SEGMENT_SPACING = 0.85;
export const SEGMENT_RADIUS = 0.42;
export const HEAD_RADIUS = 0.55;
export const START_SEGMENTS = 10;
export const MAX_SEGMENTS = 100;
export const BOOST_DRAIN_RATE = 1.5; // segments/sec lost while boosting

export const ORB_RADIUS = 0.35;
export const ORB_COUNT = 350;
export const ORB_BOB_SPEED = 2.0;
export const ORB_BOB_HEIGHT = 0.25;
export const ORB_HEIGHT_OFFSET = 0.8;

export const POWER_ORB_COUNT = 6;
export const POWER_ORB_HEIGHT_OFFSET = 1.2;
export const POWER_ORB_RADIUS = 0.55;

export const CHASE_ORB_COUNT = 18;
export const CHASE_ORB_FLEE_RADIUS = 15;
export const CHASE_ORB_SPEED = 5;
export const CHASE_ORB_RADIUS = 0.55;
export const CHASE_ORB_MASS = 3;

export const DEATH_ORB_RADIUS = 0.65;
export const DEATH_ORB_MASS = 5;
export const DEATH_ORB_LIFETIME = 45; // seconds before fading

export const AI_COUNT = 45;
export const AI_SEEK_RADIUS = 35;
export const AI_AVOID_RADIUS = 6;

export const COLLISION_CELL_SIZE = 5;

export const POWERUP_TYPES = {
  FRENZY: 'FRENZY',
  PHASE:  'PHASE',
  MAGNET: 'MAGNET',
  VENOM:  'VENOM',
  SPLIT:  'SPLIT',
};

export const POWERUP_COLORS = {
  FRENZY: 0xff2200,
  PHASE:  0x0088ff,
  MAGNET: 0x00ff44,
  VENOM:  0xaa00ff,
  SPLIT:  0xffcc00,
};

export const POWERUP_DURATIONS = {
  FRENZY: 4,
  PHASE:  5,
  MAGNET: 8,
  VENOM:  5,
  SPLIT:  6,
};

export const SERPENT_COLORS = [
  0x00ffff, // player: cyan
  0xff2244, // red
  0xff7700, // orange
  0xffee00, // yellow
  0x00ff44, // green
  0x4488ff, // blue
  0xcc00ff, // purple
  0xff44aa, // pink
];

export const GAME_STATE = {
  LOBBY:     'LOBBY',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING:   'PLAYING',
  RESULTS:   'RESULTS',
};

export const LOBBY_COUNTDOWN = 3; // seconds of 3-2-1
export const RESULTS_DURATION = 6; // seconds on results screen

export const CAMERA_HEIGHT = 22;
export const CAMERA_DISTANCE = 18;
export const CAMERA_LERP = 5.0;
export const CAMERA_FOV = 65;
export const CAMERA_BOOST_FOV = 80;

// Spatial hash
export const HASH_CELL = 5;
