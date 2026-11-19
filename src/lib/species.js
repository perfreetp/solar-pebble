// Species templates for the three wing archetypes.
//
// A wing is described in polar coordinates around its root:
//   angle φ: degrees measured from "up" (local +y), rotating toward
//            "outward" (local +x);
//   radius r: distance from the root, 1.0 = nominal wing length.
// The generator grows the outline, veins and cells from these profiles, so a
// template is just a handful of numbers — easy to read, easy to tune.
//
// Forewings sweep up-and-out, hindwings down-and-out. The left side is the
// mirror of the right, with optional seeded asymmetry.

export const SPECIES = {
  swallowtail: {
    id: 'swallowtail',
    name: '凤蝶',
    latin: 'Papilio',
    blurb: '长而尖的前翅、带尾突的后翅，放射状翅脉，黑脉金斑风格。',
    accent: '峰锐 · 有尾突 · 翅脉稀疏',
    defaults: {
      wingLength: 0.84,
      wingWidth: 0.62,
      hindRatio: 0.86,
      spotDensity: 0.5,
      hueBase: 34,
      hueWidth: 40,
      saturation: 0.86,
      lightness: 0.55,
      veinDensity: 0.42,
      spotSize: 0.6,
      marginBand: 0.66,
      asymmetry: 0.006
    },
    fore: {
      profile: [
        [-16, 0.05], [-8, 0.2], [2, 0.46], [12, 0.72], [22, 0.9], [32, 1.0],
        [42, 0.99], [52, 0.93], [62, 0.82], [72, 0.66], [82, 0.46], [90, 0.26], [97, 0.08]
      ],
      veinSpan: [6, 84],
      veinCount: 9,
      crossVeins: 3
    },
    hind: {
      profile: [
        [44, 0.06], [54, 0.26], [64, 0.5], [74, 0.72], [84, 0.86], [94, 0.92],
        [102, 0.84], [108, 0.66], [113, 0.92], [117, 1.0], [121, 0.66],
        [128, 0.44], [136, 0.22], [142, 0.06]
      ],
      veinSpan: [58, 128],
      veinCount: 7,
      crossVeins: 2,
      tail: { angle: 117, length: 1.06, width: 5 }
    }
  },
  nymphalid: {
    id: 'nymphalid',
    name: '蛱蝶',
    latin: 'Nymphalidae',
    blurb: '近三角形前翅、圆阔后翅，翅室密集，带宽条纹与眼斑。',
    accent: '翅幅宽 · 翅室密 · 波纹带',
    defaults: {
      wingLength: 0.8,
      wingWidth: 0.74,
      hindRatio: 0.88,
      spotDensity: 0.62,
      hueBase: 20,
      hueWidth: 46,
      saturation: 0.76,
      lightness: 0.5,
      veinDensity: 0.66,
      spotSize: 0.56,
      marginBand: 0.52,
      asymmetry: 0.007
    },
    fore: {
      profile: [
        [-20, 0.04], [-10, 0.24], [2, 0.52], [14, 0.78], [26, 0.94], [38, 1.0],
        [50, 0.98], [60, 0.92], [70, 0.82], [80, 0.68], [89, 0.5], [96, 0.28], [102, 0.08]
      ],
      veinSpan: [2, 88],
      veinCount: 10,
      crossVeins: 4
    },
    hind: {
      profile: [
        [46, 0.05], [58, 0.3], [70, 0.56], [82, 0.8], [94, 0.94], [106, 1.0],
        [118, 0.99], [128, 0.92], [138, 0.77], [146, 0.56], [153, 0.32], [158, 0.08]
      ],
      veinSpan: [62, 148],
      veinCount: 8,
      crossVeins: 3
    }
  },
  pierid: {
    id: 'pierid',
    name: '粉蝶',
    latin: 'Pieridae',
    blurb: '狭长前翅、圆润后翅，翅室少，大块浅色底与边缘斑点。',
    accent: '翅幅窄 · 翅室疏 · 素色底',
    defaults: {
      wingLength: 0.88,
      wingWidth: 0.52,
      hindRatio: 0.8,
      spotDensity: 0.34,
      hueBase: 56,
      hueWidth: 28,
      saturation: 0.5,
      lightness: 0.76,
      veinDensity: 0.34,
      spotSize: 0.68,
      marginBand: 0.58,
      asymmetry: 0.004
    },
    fore: {
      profile: [
        [-12, 0.04], [-2, 0.16], [8, 0.34], [18, 0.56], [28, 0.78], [38, 0.94],
        [46, 1.0], [54, 0.99], [62, 0.93], [70, 0.82], [78, 0.65], [86, 0.44], [93, 0.2], [98, 0.06]
      ],
      veinSpan: [4, 86],
      veinCount: 8,
      crossVeins: 2
    },
    hind: {
      profile: [
        [48, 0.04], [60, 0.26], [72, 0.52], [84, 0.76], [96, 0.92], [108, 0.99],
        [120, 0.97], [132, 0.86], [142, 0.66], [150, 0.4], [155, 0.16], [158, 0.04]
      ],
      veinSpan: [64, 146],
      veinCount: 6,
      crossVeins: 2
    }
  }
};

export const SPECIES_LIST = [SPECIES.swallowtail, SPECIES.nymphalid, SPECIES.pierid];

export function getSpecies(id) {
  return SPECIES[id] || SPECIES.swallowtail;
}
