import type { flowerToolGlyphs } from './flowerToolGlyphs';

// Recipes animate semantic parts of Lucide glyphs or the shared writing pencil.
// Lucide part order follows the pinned version; tests validate every track.
export type FlowerToolMotionTrack = Readonly<{
  parts: readonly number[] | 'all';
  origin?: string;
  box?: string;
  normalize?: boolean;
  base?: Readonly<Record<string, string>>;
  keyframes: Keyframe[];
  duration?: number;
  delay?: number;
  easing?: string;
}>;
export type FlowerToolMotionRecipe = Readonly<{
  icon: keyof typeof flowerToolGlyphs;
  cycle: number;
  tracks: readonly FlowerToolMotionTrack[];
}>;
// Contact phases follow the ink path's vertices; the pencil pivots around its
// graphite tip so the revealed line stays under the nib. The return is lifted.
const writingPencilMotion: FlowerToolMotionRecipe = {
  icon: 'writing-pencil',
  cycle: 2200,
  tracks: [
    {
      parts: [1, 2],
      origin: '12.5px 18.25px',
      keyframes: [
        { offset: 0, transform: 'translate(-8.5px, -1.2px) rotate(-9deg)', easing: 'cubic-bezier(.4, 0, .2, 1)' },
        { offset: 0.12, transform: 'translate(-8.5px, 0px) rotate(0deg)' },
        { offset: 0.22, transform: 'translate(-6.6px, -.6px) rotate(-4deg)' },
        { offset: 0.30, transform: 'translate(-5.4px, 0px) rotate(1deg)' },
        { offset: 0.40, transform: 'translate(-3.7px, -.5px) rotate(-3deg)' },
        { offset: 0.48, transform: 'translate(-2.5px, 0px) rotate(1deg)' },
        { offset: 0.60, transform: 'translate(0px, 0px) rotate(0deg)', easing: 'cubic-bezier(.4, 0, .2, 1)' },
        { offset: 0.70, transform: 'translate(0px, -1.2px) rotate(-9deg)', easing: 'cubic-bezier(.4, 0, .2, 1)' },
        { offset: 0.90, transform: 'translate(-8.5px, -1.2px) rotate(-9deg)' },
        { offset: 1, transform: 'translate(-8.5px, -1.2px) rotate(-9deg)' },
      ],
    },
    {
      parts: [0],
      normalize: true,
      base: { strokeDasharray: '1' },
      keyframes: [
        { offset: 0, strokeDashoffset: '1', opacity: 1 },
        { offset: 0.12, strokeDashoffset: '1', opacity: 1 },
        { offset: 0.22, strokeDashoffset: '.776', opacity: 1 },
        { offset: 0.30, strokeDashoffset: '.626', opacity: 1 },
        { offset: 0.40, strokeDashoffset: '.427', opacity: 1 },
        { offset: 0.48, strokeDashoffset: '.281', opacity: 1 },
        { offset: 0.60, strokeDashoffset: '0', opacity: 1 },
        { offset: 0.72, strokeDashoffset: '0', opacity: 1 },
        { offset: 0.86, strokeDashoffset: '0', opacity: 0 },
        { offset: 0.90, strokeDashoffset: '1', opacity: 0 },
        { offset: 1, strokeDashoffset: '1', opacity: 1 },
      ],
    },
  ],
};

const terminalCommandIcon: FlowerToolMotionRecipe = { icon: 'square-terminal', cycle: 1350, tracks: [] };

export const flowerToolMotion: Readonly<Record<string, FlowerToolMotionRecipe>> = {
  goal: { icon: 'flower-goal', cycle: 2400, tracks: [{ parts: 'all', keyframes: [{ offset: 0, opacity: 0.55 }, { offset: 0.5, opacity: 1 }, { offset: 1, opacity: 0.55 }] }] },
  "report_to_parent": { icon: 'message-square-text', cycle: 2300, tracks: [] },
  "subagent_events": { icon: 'list-tree', cycle: 2300, tracks: [] },
  "file.present": { icon: "file-text", cycle: 2400, tracks: [] },
  "file.edit": writingPencilMotion,
  "file.write": writingPencilMotion,
  "apply_patch": writingPencilMotion,
  "file.read": {
    "icon": "file-text",
    "cycle": 2700,
    "tracks": [
      {
        "parts": [
          2
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.06,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.24,
            "transform": "translateY(0px)",
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.85,
            "transform": "translateY(0px)",
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.97,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25
          }
        ],
        "easing": "linear",
        "base": {
          "strokeDasharray": "1"
        },
        "normalize": true
      },
      {
        "parts": [
          3
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.24,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.47,
            "transform": "translateY(0px)",
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.85,
            "transform": "translateY(0px)",
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.97,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25
          }
        ],
        "easing": "linear",
        "base": {
          "strokeDasharray": "1"
        },
        "normalize": true
      },
      {
        "parts": [
          4
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.47,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.7,
            "transform": "translateY(0px)",
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.85,
            "transform": "translateY(0px)",
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.97,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(1.4px)",
            "strokeDashoffset": "1",
            "opacity": 0.25
          }
        ],
        "easing": "linear",
        "base": {
          "strokeDasharray": "1"
        },
        "normalize": true
      }
    ]
  },
  "read_file": {
    "icon": "file-output",
    "cycle": 2200,
    "tracks": [
      {
        "parts": [
          2,
          3
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateX(3px)",
            "opacity": 0.15,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.12,
            "transform": "translateX(3px)",
            "opacity": 0.15,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "translateX(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.62,
            "transform": "translateX(-1px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.79,
            "transform": "translateX(-1px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.9,
            "transform": "translateX(-1px)",
            "opacity": 0,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.94,
            "transform": "translateX(3px)",
            "opacity": 0,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateX(3px)",
            "opacity": 0.15
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "read_files": {
    "icon": "files",
    "cycle": 2900,
    "tracks": [
      {
        "parts": [
          0,
          1
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(0px,0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.16,
            "transform": "translate(0px,0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "translate(-3px,3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.66,
            "transform": "translate(-3px,3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.81,
            "transform": "translate(-3px,3px)",
            "opacity": 0.35,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.87,
            "transform": "translate(0px,0px)",
            "opacity": 0.35,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(0px,0px)",
            "opacity": 1
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          2
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "opacity": 0.55,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.46,
            "opacity": 0.55,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.69,
            "opacity": 1,
            "transform": "translate(.6px,-.6px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.86,
            "opacity": 0.55,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "opacity": 0.55,
            "transform": "translate(0px,0px)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "rgrep": {
    "icon": "text-search",
    "cycle": 3100,
    "tracks": [
      {
        "parts": [
          3,
          4
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(-6px,-3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.12,
            "transform": "translate(-6px,-3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.36,
            "transform": "translate(-1px,-3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "translate(-1px,-3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.56,
            "transform": "translate(-6px,4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.81,
            "transform": "translate(0px,4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.89,
            "transform": "translate(0px,4px)",
            "opacity": 0,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.93,
            "transform": "translate(-6px,-3px)",
            "opacity": 0,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(-6px,-3px)",
            "opacity": 1
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "find": {
    "icon": "folder-search-2",
    "cycle": 3000,
    "tracks": [
      {
        "parts": [
          0,
          2
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(-3px,-1px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.11,
            "transform": "translate(-3px,-1px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.34,
            "transform": "translate(3px,-1px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "translate(3px,-1px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.56,
            "transform": "translate(-3px,2px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.74,
            "transform": "translate(3px,2px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.86,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.93,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(-3px,-1px)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "attachment.read": {
    "icon": "file-input",
    "cycle": 2600,
    "tracks": [
      {
        "parts": [
          2,
          3
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "easing": "linear",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateX(-1px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.13,
            "transform": "translateX(-1px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.48,
            "transform": "translateX(4px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.73,
            "transform": "translateX(4px)",
            "easing": "cubic-bezier(.5,0,.85,1)"
          },
          {
            "offset": 0.85,
            "transform": "translateX(-1px)",
            "easing": "linear"
          },
          {
            "offset": 1,
            "transform": "translateX(-1px)"
          }
        ]
      }
    ]
  },
  "image.read": {
    "icon": "image",
    "cycle": 3000,
    "tracks": [
      {
        "parts": [
          2
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": ".72",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.12,
            "strokeDashoffset": ".72",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.45,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.84,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.95,
            "strokeDashoffset": ".72",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": ".72"
          }
        ],
        "easing": "linear",
        "base": {
          "strokeDasharray": "1"
        },
        "normalize": true
      },
      {
        "parts": [
          1
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.4,
            "strokeDashoffset": "1",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.63,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.84,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.95,
            "strokeDashoffset": "1",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1"
          }
        ],
        "easing": "linear",
        "base": {
          "strokeDasharray": "1"
        },
        "normalize": true
      }
    ]
  },
  "terminal.exec": terminalCommandIcon,
  "terminal.read": terminalCommandIcon,
  "terminal.write": {
    "icon": "text-cursor-input",
    "cycle": 2500,
    "tracks": [
      {
        "parts": [
          0,
          3,
          4
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateX(0px)",
            "opacity": 1
          },
          {
            "offset": 0.16,
            "transform": "translateX(0px)",
            "opacity": 1
          },
          {
            "offset": 0.21,
            "transform": "translateX(2px)",
            "opacity": 1
          },
          {
            "offset": 0.39,
            "transform": "translateX(2px)",
            "opacity": 1
          },
          {
            "offset": 0.44,
            "transform": "translateX(4px)",
            "opacity": 1
          },
          {
            "offset": 0.64,
            "transform": "translateX(4px)",
            "opacity": 1
          },
          {
            "offset": 0.72,
            "transform": "translateX(4px)",
            "opacity": 0.15
          },
          {
            "offset": 0.8,
            "transform": "translateX(4px)",
            "opacity": 1
          },
          {
            "offset": 0.87,
            "transform": "translateX(4px)",
            "opacity": 0
          },
          {
            "offset": 0.9,
            "transform": "translateX(0px)",
            "opacity": 0
          },
          {
            "offset": 1,
            "transform": "translateX(0px)",
            "opacity": 1
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "terminal.terminate": {
    "icon": "circle-stop",
    "cycle": 2800,
    "tracks": [
      {
        "parts": [
          0
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "0"
          },
          {
            "offset": 0.12,
            "strokeDashoffset": "0"
          },
          {
            "offset": 0.46,
            "strokeDashoffset": "-.7"
          },
          {
            "offset": 0.85,
            "strokeDashoffset": "-.7"
          },
          {
            "offset": 1,
            "strokeDashoffset": "-1"
          }
        ],
        "easing": "linear",
        "base": {
          "strokeDasharray": ".86 .14"
        },
        "normalize": true
      },
      {
        "parts": [
          1
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(-1px) scale(1.15)",
            "opacity": 0.75,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.28,
            "transform": "translateY(-1px) scale(1.15)",
            "opacity": 0.75,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.42,
            "transform": "translateY(1.5px) scale(.8)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.52,
            "transform": "translateY(0px) scale(1)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.85,
            "transform": "translateY(0px) scale(1)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.98,
            "transform": "translateY(-1px) scale(1.15)",
            "opacity": 0.75,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(-1px) scale(1.15)",
            "opacity": 0.75,
            "easing": "cubic-bezier(.35,0,.2,1)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "threads.query": {
    "icon": "messages-square",
    "cycle": 2900,
    "tracks": [
      {
        "parts": [
          1
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(-2px,-2px)",
            "opacity": 0.15,
            "strokeDashoffset": ".4",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.17,
            "transform": "translate(-2px,-2px)",
            "opacity": 0.15,
            "strokeDashoffset": ".4",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "translate(0px,0px)",
            "opacity": 1,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.77,
            "transform": "translate(0px,0px)",
            "opacity": 1,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.91,
            "transform": "translate(-2px,-2px)",
            "opacity": 0.15,
            "strokeDashoffset": ".4",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(-2px,-2px)",
            "opacity": 0.15,
            "strokeDashoffset": ".4"
          }
        ],
        "easing": "linear",
        "base": {
          "strokeDasharray": "1"
        },
        "normalize": true
      }
    ]
  },
  "threads.read": {
    "icon": "message-square-text",
    "cycle": 2700,
    "tracks": [
      {
        "parts": [
          1,
          2,
          3
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(3px)",
            "opacity": 0.35,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.12,
            "transform": "translateY(3px)",
            "opacity": 0.35,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.41,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.61,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.83,
            "transform": "translateY(-3px)",
            "opacity": 0.35,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.9,
            "transform": "translateY(-3px)",
            "opacity": 0,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.94,
            "transform": "translateY(3px)",
            "opacity": 0,
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(3px)",
            "opacity": 0.35
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "threads.aggregate": {
    "icon": "chart-column",
    "cycle": 3100,
    "tracks": [
      {
        "parts": [
          3
        ],
        "origin": "8px 17px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.09,
            "transform": "scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.2,
            "transform": "scaleY(.55)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.27,
            "transform": "scaleY(.55)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.34,
            "transform": "scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.86,
            "transform": "scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.97,
            "transform": "scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "scaleY(.12)"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          2
        ],
        "origin": "13px 17px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.22,
            "transform": "scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.34,
            "transform": "scaleY(.32)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.42,
            "transform": "scaleY(.32)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.54,
            "transform": "scaleY(.72)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.61,
            "transform": "scaleY(.72)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.69,
            "transform": "scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.86,
            "transform": "scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.97,
            "transform": "scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "scaleY(.12)"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          1
        ],
        "origin": "18px 17px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.39,
            "transform": "scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.5,
            "transform": "scaleY(.46)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.59,
            "transform": "scaleY(.46)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.75,
            "transform": "scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.86,
            "transform": "scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.97,
            "transform": "scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "scaleY(.12)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "web.search": {
    "icon": "search",
    "cycle": 3200,
    "tracks": [
      {
        "parts": "all",
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(-2px,-2px) scale(.8)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.09,
            "transform": "translate(-2px,-2px) scale(.8)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.31,
            "transform": "translate(2px,-2px) scale(.8)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.4,
            "transform": "translate(2px,-2px) scale(.8)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.59,
            "transform": "translate(-2px,2px) scale(.8)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.68,
            "transform": "translate(-2px,2px) scale(.8)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.8,
            "transform": "translate(0px,0px) scale(.96)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.93,
            "transform": "translate(0px,0px) scale(.96)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(-2px,-2px) scale(.8)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "web_search": {
    "icon": "scan-search",
    "cycle": 3300,
    "tracks": [
      {
        "parts": [
          4,
          5
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(-4px,-4px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.08,
            "transform": "translate(-4px,-4px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.3,
            "transform": "translate(3px,-4px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.38,
            "transform": "translate(3px,-4px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.48,
            "transform": "translate(-4px,3px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.68,
            "transform": "translate(3px,3px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.77,
            "transform": "translate(3px,3px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.88,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.94,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(-4px,-4px)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "web_fetch": {
    "icon": "earth",
    "cycle": 3100,
    "tracks": [
      {
        "parts": [
          1
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": ".78",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.04,
            "strokeDashoffset": ".78",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.29,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.85,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.97,
            "strokeDashoffset": ".78",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": ".78"
          }
        ],
        "easing": "linear",
        "base": {
          "strokeDasharray": "1"
        },
        "normalize": true
      },
      {
        "parts": [
          0
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": ".78",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.3,
            "strokeDashoffset": ".78",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.51,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.85,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.97,
            "strokeDashoffset": ".78",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": ".78"
          }
        ],
        "easing": "linear",
        "base": {
          "strokeDasharray": "1"
        },
        "normalize": true
      },
      {
        "parts": [
          2
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": ".78",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.53,
            "strokeDashoffset": ".78",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.75,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.85,
            "strokeDashoffset": "0",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.97,
            "strokeDashoffset": ".78",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": ".78"
          }
        ],
        "easing": "linear",
        "base": {
          "strokeDasharray": "1"
        },
        "normalize": true
      }
    ]
  },
  "sources": {
    "icon": "link",
    "cycle": 2600,
    "tracks": [
      {
        "parts": [
          0
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(2px,-2px) scale(.9)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.18,
            "transform": "translate(2px,-2px) scale(.9)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.42,
            "transform": "translate(-.4px,.4px) scale(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.52,
            "transform": "translate(0px,0px) scale(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.85,
            "transform": "translate(0px,0px) scale(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(2px,-2px) scale(.9)"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          1
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(-2px,2px) scale(.9)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.18,
            "transform": "translate(-2px,2px) scale(.9)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.42,
            "transform": "translate(.4px,-.4px) scale(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.52,
            "transform": "translate(0px,0px) scale(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.85,
            "transform": "translate(0px,0px) scale(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(-2px,2px) scale(.9)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.targets": {
    "icon": "layout-grid",
    "cycle": 2200,
    "tracks": [
      {
        "parts": [
          0
        ],
        "origin": "6.5px 6.5px",
        "base": {
          "fill": "currentColor",
          "fillOpacity": "0"
        },
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.18,
            "transform": "translateY(0px) scale(1.1)",
            "opacity": 1,
            "strokeWidth": "2.1",
            "fillOpacity": ".08",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.26,
            "transform": "scale(1)",
            "opacity": 1,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.82,
            "transform": "scale(1)",
            "opacity": 1,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          1
        ],
        "origin": "17.5px 6.5px",
        "base": {
          "fill": "currentColor",
          "fillOpacity": "0"
        },
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.17,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.35,
            "transform": "translateY(0px) scale(1.1)",
            "opacity": 1,
            "strokeWidth": "2.1",
            "fillOpacity": ".08",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "scale(1)",
            "opacity": 1,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.82,
            "transform": "scale(1)",
            "opacity": 1,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          3
        ],
        "origin": "6.5px 17.5px",
        "base": {
          "fill": "currentColor",
          "fillOpacity": "0"
        },
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.34,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.52,
            "transform": "translateY(0px) scale(1.1)",
            "opacity": 1,
            "strokeWidth": "2.1",
            "fillOpacity": ".08",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.6,
            "transform": "scale(1)",
            "opacity": 1,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.82,
            "transform": "scale(1)",
            "opacity": 1,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          2
        ],
        "origin": "17.5px 17.5px",
        "base": {
          "fill": "currentColor",
          "fillOpacity": "0"
        },
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.51,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.69,
            "transform": "translateY(0px) scale(1.1)",
            "opacity": 1,
            "strokeWidth": "2.1",
            "fillOpacity": ".08",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.77,
            "transform": "scale(1)",
            "opacity": 1,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.82,
            "transform": "scale(1)",
            "opacity": 1,
            "strokeWidth": "1.7",
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(1.2px) scale(.82)",
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "fillOpacity": "0"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.select_target": {
    "icon": "square-mouse-pointer",
    "cycle": 1700,
    "tracks": [
      {
        "parts": [
          0
        ],
        "origin": "12.7px 12.7px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(2px,2px) scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.32,
            "transform": "translate(0px,0px) scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "translate(0px,0px) scale(.84)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.55,
            "transform": "translate(0px,0px) scale(1.04)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.64,
            "transform": "translate(0px,0px) scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.82,
            "transform": "translate(0px,0px) scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(2px,2px) scale(1)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.observe": {
    "icon": "scan-eye",
    "cycle": 2200,
    "tracks": [
      {
        "parts": [
          4
        ],
        "origin": "12px 12px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(0px,0px) scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.14,
            "transform": "translate(-2.2px,0px) scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.28,
            "transform": "translate(-2.2px,0px) scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "translate(2.2px,-.7px) scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.56,
            "transform": "translate(2.2px,-.7px) scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.68,
            "transform": "translate(0px,0px) scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.76,
            "transform": "translate(0px,0px) scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.82,
            "transform": "translate(0px,0px) scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(0px,0px) scaleY(1)"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          5
        ],
        "origin": "12px 12px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.68,
            "transform": "scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.76,
            "transform": "scaleY(.12)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 0.82,
            "transform": "scaleY(1)",
            "easing": "cubic-bezier(.35,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "scaleY(1)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.exec": {
    "icon": "code-2",
    "cycle": 1900,
    "tracks": [
      {
        "parts": [
          0
        ],
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateX(0px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.22,
            "transform": "translateX(1.3px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.64,
            "transform": "translateX(1.3px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.8,
            "transform": "translateX(0px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateX(0px)"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          1
        ],
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateX(0px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.22,
            "transform": "translateX(-1.3px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.64,
            "transform": "translateX(-1.3px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.8,
            "transform": "translateX(0px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateX(0px)"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          2
        ],
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        },
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.22,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.62,
            "strokeDashoffset": "0"
          },
          {
            "offset": 0.83,
            "strokeDashoffset": "0"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.screenshot": {
    "icon": "camera",
    "cycle": 1800,
    "tracks": [
      {
        "parts": [
          1
        ],
        "origin": "12px 13px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "scale(1)",
            "fill": "none",
            "easing": "cubic-bezier(.2,.65,.25,1)"
          },
          {
            "offset": 0.36,
            "transform": "scale(1)",
            "fill": "none",
            "easing": "cubic-bezier(.2,.65,.25,1)"
          },
          {
            "offset": 0.44,
            "transform": "scale(.12)",
            "fill": "currentColor",
            "easing": "cubic-bezier(.2,.65,.25,1)"
          },
          {
            "offset": 0.5,
            "transform": "scale(.12)",
            "fill": "currentColor",
            "easing": "cubic-bezier(.2,.65,.25,1)"
          },
          {
            "offset": 0.59,
            "transform": "scale(1.12)",
            "fill": "none",
            "easing": "cubic-bezier(.2,.65,.25,1)"
          },
          {
            "offset": 0.7,
            "transform": "scale(1)",
            "fill": "none",
            "easing": "cubic-bezier(.2,.65,.25,1)"
          },
          {
            "offset": 1,
            "transform": "scale(1)",
            "fill": "none"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.click": {
    "icon": "mouse-pointer-2",
    "cycle": 1700,
    "tracks": [
      {
        "parts": [
          0
        ],
        "origin": "4px 4px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(2.4px,1.6px) scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.28,
            "transform": "translate(0px,0px) scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.38,
            "transform": "translate(0px,0px) scale(.82)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.51,
            "transform": "translate(0px,0px) scale(1.02)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.6,
            "transform": "translate(0px,0px) scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.82,
            "transform": "translate(0px,0px) scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(2.4px,1.6px) scale(1)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.double_click": {
    "icon": "mouse-pointer-click",
    "cycle": 2000,
    "tracks": [
      {
        "parts": [
          4
        ],
        "origin": "9px 9px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.23,
            "transform": "scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.3,
            "transform": "scale(.83)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.37,
            "transform": "scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.44,
            "transform": "scale(.83)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.51,
            "transform": "scale(1)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "scale(1)"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          0,
          1,
          2,
          3
        ],
        "origin": "9px 9px",
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        },
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1",
            "transform": "scale(.78)",
            "opacity": 0
          },
          {
            "offset": 0.26,
            "strokeDashoffset": "1",
            "transform": "scale(.78)",
            "opacity": 0
          },
          {
            "offset": 0.34,
            "strokeDashoffset": "0",
            "transform": "scale(1.04)",
            "opacity": 1
          },
          {
            "offset": 0.4,
            "strokeDashoffset": "1",
            "transform": "scale(1.12)",
            "opacity": 0
          },
          {
            "offset": 0.42,
            "strokeDashoffset": "1",
            "transform": "scale(.78)",
            "opacity": 0
          },
          {
            "offset": 0.48,
            "strokeDashoffset": "0",
            "transform": "scale(1.04)",
            "opacity": 1
          },
          {
            "offset": 0.56,
            "strokeDashoffset": "1",
            "transform": "scale(1.12)",
            "opacity": 0
          },
          {
            "offset": 1,
            "strokeDashoffset": "1",
            "transform": "scale(.78)",
            "opacity": 0
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.type": {
    "icon": "keyboard",
    "cycle": 2200,
    "tracks": [
      {
        "parts": [
          5
        ],
        "origin": "6px 8px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.05,
            "transform": "translateY(1.2px) scale(1.65)",
            "strokeWidth": "2.2",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.14,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          0
        ],
        "origin": "10px 8px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.12,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.17,
            "transform": "translateY(1.2px) scale(1.65)",
            "strokeWidth": "2.2",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.26,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          2
        ],
        "origin": "14px 8px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.24,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.29,
            "transform": "translateY(1.2px) scale(1.65)",
            "strokeWidth": "2.2",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.38,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          7
        ],
        "origin": "8px 12px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.36,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.41,
            "transform": "translateY(1.2px) scale(1.65)",
            "strokeWidth": "2.2",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.5,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          1
        ],
        "origin": "12px 12px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.48,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.53,
            "transform": "translateY(1.2px) scale(1.65)",
            "strokeWidth": "2.2",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.62,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          3
        ],
        "origin": "16px 12px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.6,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.65,
            "transform": "translateY(1.2px) scale(1.65)",
            "strokeWidth": "2.2",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.74,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px) scale(1)",
            "strokeWidth": "1.7"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          6
        ],
        "origin": "12px 16px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.76,
            "transform": "translateY(0px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.82,
            "transform": "translateY(1.4px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.94,
            "transform": "translateY(0px)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.key": {
    "icon": "command",
    "cycle": 1700,
    "tracks": [
      {
        "parts": [
          0
        ],
        "origin": "12px 12px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.2,
            "transform": "translateY(0px)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.32,
            "transform": "translateY(2.1px)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "translateY(2.1px)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.56,
            "transform": "translateY(-.4px)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.68,
            "transform": "translateY(0px)",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.scroll": {
    "icon": "mouse",
    "cycle": 1450,
    "tracks": [
      {
        "parts": [
          1
        ],
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.48,
            "transform": "translateY(3.3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.6,
            "transform": "translateY(3.3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.75,
            "transform": "translateY(4px)",
            "opacity": 0,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.76,
            "transform": "translateY(-1px)",
            "opacity": 0,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.9,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px)",
            "opacity": 1
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.drag": {
    "icon": "move",
    "cycle": 1900,
    "tracks": [
      {
        "parts": "all",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(-1.9px,1.3px)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.12,
            "transform": "translate(-1.9px,1.3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.52,
            "transform": "translate(1.9px,-1.3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.74,
            "transform": "translate(1.9px,-1.3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.9,
            "transform": "translate(1.9px,-1.3px)",
            "opacity": 0,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.91,
            "transform": "translate(-1.9px,1.3px)",
            "opacity": 0,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 1,
            "transform": "translate(-1.9px,1.3px)",
            "opacity": 0.5
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "computer.wait": {
    "icon": "timer",
    "cycle": 2400,
    "tracks": [
      {
        "parts": [
          1
        ],
        "origin": "12px 14px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "rotate(0deg)"
          },
          {
            "offset": 1,
            "transform": "rotate(360deg)"
          }
        ],
        "easing": "steps(12,end)"
      }
    ]
  },
  "browser.navigate": {
    "icon": "compass",
    "cycle": 2300,
    "tracks": [
      {
        "parts": [
          1
        ],
        "origin": "12px 12px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "rotate(-85deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.31,
            "transform": "rotate(12deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "rotate(-4deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.53,
            "transform": "rotate(0deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.8,
            "transform": "rotate(0deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.91,
            "transform": "rotate(0deg)",
            "opacity": 0,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.92,
            "transform": "rotate(-85deg)",
            "opacity": 0,
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "rotate(-85deg)",
            "opacity": 1
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "browser.back": {
    "icon": "arrow-left",
    "cycle": 1700,
    "tracks": [
      {
        "parts": [
          0,
          1
        ],
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateX(2.3px)",
            "opacity": 0.55,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.14,
            "transform": "translateX(2.3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.48,
            "transform": "translateX(-2.3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.7,
            "transform": "translateX(-2.3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.92,
            "transform": "translateX(2.3px)",
            "opacity": 0.55,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 1,
            "transform": "translateX(2.3px)",
            "opacity": 0.55
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "browser.reload": {
    "icon": "rotate-cw",
    "cycle": 1900,
    "tracks": [
      {
        "parts": [
          0,
          1
        ],
        "origin": "12px 12px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "rotate(0deg)",
            "easing": "cubic-bezier(.45,0,.2,1)"
          },
          {
            "offset": 0.73,
            "transform": "rotate(360deg)",
            "easing": "cubic-bezier(.45,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "rotate(360deg)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "write_todos": {
    "icon": "list-todo",
    "cycle": 2100,
    "tracks": [
      {
        "parts": [
          0
        ],
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        },
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.21,
            "strokeDashoffset": "0"
          },
          {
            "offset": 0.88,
            "strokeDashoffset": "0"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          1
        ],
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        },
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.17,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.38,
            "strokeDashoffset": "0"
          },
          {
            "offset": 0.88,
            "strokeDashoffset": "0"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          2
        ],
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        },
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.34,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.55,
            "strokeDashoffset": "0"
          },
          {
            "offset": 0.88,
            "strokeDashoffset": "0"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          3
        ],
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        },
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.56,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.76,
            "strokeDashoffset": "0"
          },
          {
            "offset": 0.88,
            "strokeDashoffset": "0"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "ask_user": {
    "icon": "message-circle-question-mark",
    "cycle": 2600,
    "tracks": [
      {
        "parts": [
          1
        ],
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        },
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.12,
            "strokeDashoffset": "1"
          },
          {
            "offset": 0.45,
            "strokeDashoffset": "0"
          },
          {
            "offset": 0.9,
            "strokeDashoffset": "0"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          2
        ],
        "origin": "12px 17px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(1px) scale(.4)",
            "opacity": 0,
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "translateY(1px) scale(.4)",
            "opacity": 0,
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.52,
            "transform": "translateY(0px) scale(1.6)",
            "opacity": 1,
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.6,
            "transform": "translateY(0px) scale(1)",
            "opacity": 1,
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.9,
            "transform": "translateY(0px) scale(1)",
            "opacity": 1,
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(1px) scale(.4)",
            "opacity": 0
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "subagents": {
    "icon": "git-fork",
    "cycle": 2300,
    "tracks": [
      {
        "parts": [
          4
        ],
        "keyframes": [
          {
            "offset": 0,
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.2,
            "opacity": 1,
            "strokeWidth": "2.6",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.32,
            "opacity": 1,
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.88,
            "opacity": 1,
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "opacity": 0.55,
            "strokeWidth": "1.7"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          3
        ],
        "keyframes": [
          {
            "offset": 0,
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.17,
            "opacity": 0.55,
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.4,
            "opacity": 1,
            "strokeWidth": "2.6",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.52,
            "opacity": 1,
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.88,
            "opacity": 1,
            "strokeWidth": "1.7",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "opacity": 0.55,
            "strokeWidth": "1.7"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          1
        ],
        "origin": "6px 6px",
        "base": {
          "fill": "currentColor",
          "fillOpacity": "0"
        },
        "keyframes": [
          {
            "offset": 0,
            "transform": "scale(1)",
            "opacity": 0.55,
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.36,
            "transform": "scale(1)",
            "opacity": 0.55,
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.51,
            "transform": "scale(1.32)",
            "opacity": 1,
            "fillOpacity": ".16",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.62,
            "transform": "scale(1)",
            "opacity": 1,
            "fillOpacity": ".07",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.88,
            "transform": "scale(1)",
            "opacity": 1,
            "fillOpacity": ".07",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "scale(1)",
            "opacity": 0.55,
            "fillOpacity": "0"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          2
        ],
        "origin": "18px 6px",
        "base": {
          "fill": "currentColor",
          "fillOpacity": "0"
        },
        "keyframes": [
          {
            "offset": 0,
            "transform": "scale(1)",
            "opacity": 0.55,
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.53,
            "transform": "scale(1)",
            "opacity": 0.55,
            "fillOpacity": "0",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.68,
            "transform": "scale(1.32)",
            "opacity": 1,
            "fillOpacity": ".16",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.79,
            "transform": "scale(1)",
            "opacity": 1,
            "fillOpacity": ".07",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 0.88,
            "transform": "scale(1)",
            "opacity": 1,
            "fillOpacity": ".07",
            "easing": "cubic-bezier(.2,.7,.2,1)"
          },
          {
            "offset": 1,
            "transform": "scale(1)",
            "opacity": 0.55,
            "fillOpacity": "0"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "tessiven.runtimes": {
    "icon": "server",
    "cycle": 2200,
    "tracks": [
      {
        "parts": [
          2
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateX(0px)",
            "opacity": 0.55,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.02,
            "transform": "translateX(0px)",
            "opacity": 0.55,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.04,
            "transform": "translateX(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.26,
            "transform": "translateX(12px)",
            "opacity": 1,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.34,
            "transform": "translateX(12px)",
            "opacity": 1,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.36,
            "transform": "translateX(12px)",
            "opacity": 0,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.38,
            "transform": "translateX(0px)",
            "opacity": 0,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 1,
            "transform": "translateX(0px)",
            "opacity": 0.55
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          3
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateX(0px)",
            "opacity": 0.55,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.5,
            "transform": "translateX(0px)",
            "opacity": 0.55,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.52,
            "transform": "translateX(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.74,
            "transform": "translateX(12px)",
            "opacity": 1,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.82,
            "transform": "translateX(12px)",
            "opacity": 1,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.84,
            "transform": "translateX(12px)",
            "opacity": 0,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 0.86,
            "transform": "translateX(0px)",
            "opacity": 0,
            "easing": "cubic-bezier(.32,0,.24,1)"
          },
          {
            "offset": 1,
            "transform": "translateX(0px)",
            "opacity": 0.55
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          0
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "opacity": 0.5
          },
          {
            "offset": 0.02,
            "opacity": 1
          },
          {
            "offset": 0.37,
            "opacity": 1
          },
          {
            "offset": 0.46,
            "opacity": 0.5
          },
          {
            "offset": 1,
            "opacity": 0.5
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          1
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "opacity": 0.5
          },
          {
            "offset": 0.49,
            "opacity": 0.5
          },
          {
            "offset": 0.5,
            "opacity": 1
          },
          {
            "offset": 0.86,
            "opacity": 1
          },
          {
            "offset": 0.95,
            "opacity": 0.5
          },
          {
            "offset": 1,
            "opacity": 0.5
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "tessiven.runtime.inspect": {
    "icon": "scan-line",
    "cycle": 1900,
    "tracks": [
      {
        "parts": [
          4
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(-6px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.3,1)"
          },
          {
            "offset": 0.06,
            "transform": "translateY(-6px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.3,1)"
          },
          {
            "offset": 0.64,
            "transform": "translateY(6px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.3,1)"
          },
          {
            "offset": 0.76,
            "transform": "translateY(6px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.3,1)"
          },
          {
            "offset": 0.84,
            "transform": "translateY(6px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.3,1)"
          },
          {
            "offset": 0.9,
            "transform": "translateY(-6px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.3,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(-6px)",
            "opacity": 0
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "tessiven.runtime.action": {
    "icon": "cog",
    "cycle": 2100,
    "tracks": [
      {
        "parts": "all",
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "rotate(0deg)"
          },
          {
            "offset": 0.12,
            "transform": "rotate(12deg)"
          },
          {
            "offset": 0.77,
            "transform": "rotate(337deg)"
          },
          {
            "offset": 0.9,
            "transform": "rotate(360deg)"
          },
          {
            "offset": 1,
            "transform": "rotate(360deg)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "tessiven.schema": {
    "icon": "network",
    "cycle": 2100,
    "tracks": [
      {
        "parts": [
          4
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.04,
            "strokeDashoffset": "1",
            "opacity": 0.7,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.22,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.83,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.95,
            "strokeDashoffset": "0",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.96,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1",
            "opacity": 0.38
          }
        ],
        "easing": "linear",
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        }
      },
      {
        "parts": [
          3
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.28,
            "strokeDashoffset": "1",
            "opacity": 0.7,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.65,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.83,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.95,
            "strokeDashoffset": "0",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.96,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1",
            "opacity": 0.38
          }
        ],
        "easing": "linear",
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        }
      }
    ]
  },
  "tessiven.list": {
    "icon": "list-tree",
    "cycle": 2100,
    "tracks": [
      {
        "parts": [
          0
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.04,
            "strokeDashoffset": "1",
            "opacity": 0.7,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.2,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.82,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.95,
            "strokeDashoffset": "0",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.96,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1",
            "opacity": 0.38
          }
        ],
        "easing": "linear",
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        }
      },
      {
        "parts": [
          1
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.29,
            "strokeDashoffset": "1",
            "opacity": 0.7,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.45,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.82,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.95,
            "strokeDashoffset": "0",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.96,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1",
            "opacity": 0.38
          }
        ],
        "easing": "linear",
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        }
      },
      {
        "parts": [
          2
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.54,
            "strokeDashoffset": "1",
            "opacity": 0.7,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.7,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.82,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.95,
            "strokeDashoffset": "0",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.96,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1",
            "opacity": 0.38
          }
        ],
        "easing": "linear",
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        }
      }
    ]
  },
  "tessiven.read": {
    "icon": "database",
    "cycle": 1900,
    "tracks": [
      {
        "parts": [
          2
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(3px)",
            "opacity": 0.2,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.12,
            "transform": "translateY(3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.62,
            "transform": "translateY(-4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.72,
            "transform": "translateY(-4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.84,
            "transform": "translateY(-4px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.91,
            "transform": "translateY(3px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(3px)",
            "opacity": 0.2
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "tessiven.search": {
    "icon": "search",
    "cycle": 2400,
    "tracks": [
      {
        "parts": "all",
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.12,
            "transform": "translate(-1.4px,-1.4px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.22,
            "transform": "translate(-1.4px,-1.4px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.34,
            "transform": "translate(1.3px,-1.4px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.44,
            "transform": "translate(1.3px,-1.4px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.56,
            "transform": "translate(1.3px,1.3px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.66,
            "transform": "translate(1.3px,1.3px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.78,
            "transform": "translate(-1.4px,1.3px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.86,
            "transform": "translate(-1.4px,1.3px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.95,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(0px,0px)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "tessiven.edit": writingPencilMotion,
  "tessiven.versions": {
    "icon": "history",
    "cycle": 2400,
    "tracks": [
      {
        "parts": [
          2
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "rotate(0deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.13,
            "transform": "rotate(-90deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.24,
            "transform": "rotate(-90deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.37,
            "transform": "rotate(-180deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.48,
            "transform": "rotate(-180deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.61,
            "transform": "rotate(-270deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.72,
            "transform": "rotate(-270deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.85,
            "transform": "rotate(-360deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "rotate(-360deg)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "tessiven.validate": {
    "icon": "list-checks",
    "cycle": 2200,
    "tracks": [
      {
        "parts": [
          4
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.08,
            "strokeDashoffset": "1",
            "opacity": 0.7,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.28,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.84,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.95,
            "strokeDashoffset": "0",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.96,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1",
            "opacity": 0.38
          }
        ],
        "easing": "linear",
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        }
      },
      {
        "parts": [
          3
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.44,
            "strokeDashoffset": "1",
            "opacity": 0.7,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.64,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.84,
            "strokeDashoffset": "0",
            "opacity": 1,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.95,
            "strokeDashoffset": "0",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 0.96,
            "strokeDashoffset": "1",
            "opacity": 0.38,
            "easing": "cubic-bezier(.35,0,.25,1)"
          },
          {
            "offset": 1,
            "strokeDashoffset": "1",
            "opacity": 0.38
          }
        ],
        "easing": "linear",
        "normalize": true,
        "base": {
          "strokeDasharray": "1"
        }
      }
    ]
  },
  "tessiven.save": {
    "icon": "hard-drive-download",
    "cycle": 1900,
    "tracks": [
      {
        "parts": [
          0,
          1
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.4,0,.25,1)"
          },
          {
            "offset": 0.16,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.4,0,.25,1)"
          },
          {
            "offset": 0.5,
            "transform": "translateY(3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.4,0,.25,1)"
          },
          {
            "offset": 0.6,
            "transform": "translateY(3px)",
            "opacity": 1,
            "easing": "cubic-bezier(.4,0,.25,1)"
          },
          {
            "offset": 0.7,
            "transform": "translateY(3px)",
            "opacity": 0,
            "easing": "cubic-bezier(.4,0,.25,1)"
          },
          {
            "offset": 0.84,
            "transform": "translateY(0px)",
            "opacity": 0,
            "easing": "cubic-bezier(.4,0,.25,1)"
          },
          {
            "offset": 0.94,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.4,0,.25,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px)",
            "opacity": 1
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          3
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "opacity": 0.4
          },
          {
            "offset": 0.54,
            "opacity": 0.4
          },
          {
            "offset": 0.6,
            "opacity": 1
          },
          {
            "offset": 0.76,
            "opacity": 1
          },
          {
            "offset": 0.89,
            "opacity": 0.4
          },
          {
            "offset": 1,
            "opacity": 0.4
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          4
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "opacity": 0.4
          },
          {
            "offset": 0.67,
            "opacity": 0.4
          },
          {
            "offset": 0.73,
            "opacity": 1
          },
          {
            "offset": 0.89,
            "opacity": 1
          },
          {
            "offset": 1,
            "opacity": 0.4
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "tessiven.inspect": {
    "icon": "scan-search",
    "cycle": 2250,
    "tracks": [
      {
        "parts": [
          4,
          5
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.13,
            "transform": "translate(-3px,-3px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.24,
            "transform": "translate(-3px,-3px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.4,
            "transform": "translate(3px,-3px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.5,
            "transform": "translate(3px,-3px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.67,
            "transform": "translate(3px,3px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.77,
            "transform": "translate(3px,3px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.9,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(0px,0px)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "tessiven.action": {
    "icon": "square-play",
    "cycle": 1600,
    "tracks": [
      {
        "parts": [
          1
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateX(-1.4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.14,
            "transform": "translateX(-1.4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.48,
            "transform": "translateX(2.1px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.66,
            "transform": "translateX(2.1px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.78,
            "transform": "translateX(2.1px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.84,
            "transform": "translateX(-1.4px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.94,
            "transform": "translateX(-1.4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translateX(-1.4px)",
            "opacity": 1
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "okf.index": {
    "icon": "book-marked",
    "cycle": 1850,
    "tracks": [
      {
        "parts": [
          0
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.4,0,.22,1)"
          },
          {
            "offset": 0.16,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.4,0,.22,1)"
          },
          {
            "offset": 0.53,
            "transform": "translateY(4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.4,0,.22,1)"
          },
          {
            "offset": 0.68,
            "transform": "translateY(4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.4,0,.22,1)"
          },
          {
            "offset": 0.78,
            "transform": "translateY(4px)",
            "opacity": 0,
            "easing": "cubic-bezier(.4,0,.22,1)"
          },
          {
            "offset": 0.86,
            "transform": "translateY(0px)",
            "opacity": 0,
            "easing": "cubic-bezier(.4,0,.22,1)"
          },
          {
            "offset": 0.95,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.4,0,.22,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(0px)",
            "opacity": 1
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "okf.search": {
    "icon": "book-search",
    "cycle": 2200,
    "tracks": [
      {
        "parts": [
          1,
          3
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.22,
            "transform": "translate(-2px,-5px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.34,
            "transform": "translate(-2px,-5px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.54,
            "transform": "translate(1px,-5px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.66,
            "transform": "translate(1px,-5px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.86,
            "transform": "translate(0px,0px)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "translate(0px,0px)"
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "okf.open": {
    "icon": "book-open-text",
    "cycle": 2400,
    "tracks": [
      {
        "parts": [
          4,
          5
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(2px)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.1,
            "transform": "translateY(2px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.35,
            "transform": "translateY(-2px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.43,
            "transform": "translateY(-2px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.5,
            "transform": "translateY(-2px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.57,
            "transform": "translateY(2px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.67,
            "transform": "translateY(2px)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(2px)",
            "opacity": 0.5
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          1,
          2
        ],
        "origin": "12px 12px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(2px)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.46,
            "transform": "translateY(2px)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.54,
            "transform": "translateY(2px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.78,
            "transform": "translateY(-2px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.84,
            "transform": "translateY(-2px)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.91,
            "transform": "translateY(-2px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 0.96,
            "transform": "translateY(2px)",
            "opacity": 0,
            "easing": "cubic-bezier(.3,0,.25,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(2px)",
            "opacity": 0.5
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "use_skill": {
    "icon": "wand-sparkles",
    "cycle": 1900,
    "tracks": [
      {
        "parts": [
          0,
          1
        ],
        "origin": "3px 20px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "rotate(-4deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.18,
            "transform": "rotate(-4deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.4,
            "transform": "rotate(3deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.62,
            "transform": "rotate(3deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 0.84,
            "transform": "rotate(-4deg)",
            "easing": "cubic-bezier(.4,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "rotate(-4deg)"
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          4,
          7
        ],
        "origin": "10px 3px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "scale(.65) rotate(0deg)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.28,
            "transform": "scale(.65) rotate(0deg)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.4,
            "transform": "scale(1.15) rotate(90deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.61,
            "transform": "scale(1) rotate(90deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.8,
            "transform": "scale(.65) rotate(90deg)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "scale(.65) rotate(0deg)",
            "opacity": 0.5
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          2,
          5
        ],
        "origin": "5px 8px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "scale(.65) rotate(0deg)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.43,
            "transform": "scale(.65) rotate(0deg)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.56,
            "transform": "scale(1.1) rotate(90deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.71,
            "transform": "scale(1) rotate(90deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.91,
            "transform": "scale(.65) rotate(90deg)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "scale(.65) rotate(0deg)",
            "opacity": 0.5
          }
        ],
        "easing": "linear"
      },
      {
        "parts": [
          3,
          6
        ],
        "origin": "19px 16px",
        "box": "view-box",
        "keyframes": [
          {
            "offset": 0,
            "transform": "scale(.65) rotate(0deg)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.54,
            "transform": "scale(.65) rotate(0deg)",
            "opacity": 0.5,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.68,
            "transform": "scale(1.1) rotate(90deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 0.81,
            "transform": "scale(1) rotate(90deg)",
            "opacity": 1,
            "easing": "cubic-bezier(.3,0,.2,1)"
          },
          {
            "offset": 1,
            "transform": "scale(.65) rotate(0deg)",
            "opacity": 0.5
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "mcp": {
    "icon": "plug",
    "cycle": 1900,
    "tracks": [
      {
        "parts": [
          1,
          2,
          3
        ],
        "keyframes": [
          {
            "offset": 0,
            "transform": "translateY(-1.4px)",
            "opacity": 0.65,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.13,
            "transform": "translateY(-1.4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.39,
            "transform": "translateY(.4px)",
            "opacity": 1,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.5,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.78,
            "transform": "translateY(0px)",
            "opacity": 1,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 0.94,
            "transform": "translateY(-1.4px)",
            "opacity": 0.65,
            "easing": "cubic-bezier(.22,.61,.36,1)"
          },
          {
            "offset": 1,
            "transform": "translateY(-1.4px)",
            "opacity": 0.65
          }
        ],
        "easing": "linear"
      }
    ]
  },
  "unknown": {
    "icon": "wrench",
    "cycle": 2000,
    "tracks": [
      {
        "parts": [
          0
        ],
        "origin": "16px 8px",
        "keyframes": [
          {
            "offset": 0,
            "transform": "rotate(-10deg)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.12,
            "transform": "rotate(-10deg)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.58,
            "transform": "rotate(8deg)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.65,
            "transform": "rotate(8deg)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 0.73,
            "transform": "rotate(-10deg)",
            "easing": "cubic-bezier(.25,.6,.2,1)"
          },
          {
            "offset": 1,
            "transform": "rotate(-10deg)"
          }
        ],
        "easing": "linear"
      }
    ]
  }
};
