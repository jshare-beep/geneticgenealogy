// The app's hedgerow palette, used for lineages (the colored dot groups). Order chosen
// so any two adjacent picks (the common case of just 2 lineages) read as clearly
// different on both the map and the tree. Deliberately just 6, not the full 13-color
// hedgerow set - six lineages is already a lot to tell apart on one map, and every
// color left out here is left out for a reason, not just to round out the list:
//   - Hawthorn Blossom / Silver Birch: near-white/pale, don't read as a marker at all
//     on a light map.
//   - Blackthorn Berry (dark navy): this is the exact color the map tints its own
//     ocean water to (see WATER_TINT in map/mapView.js) - a lineage dot in this color
//     all but disappears over open water.
//   - Gorse Bloom (gold) / Cowslip Meadow (soft yellow): both already mean something
//     specific on the map - the numbered overlap-star markers use gold for a crossing
//     that includes every uploaded line, and this same soft yellow for a partial one
//     (see .overlap-star in css/components.css). A lineage dot in either would be
//     mistaken for one of those, not an ordinary person.
//   - Dog Rose / Wild Honeysuckle: the two softest/palest of the remaining colors -
//     left out in favor of keeping all six picks equally punchy against both the map
//     and the tree, rather than tapering off into pastels.
export const LINEAGE_PALETTE = [
  '#40654a', // Ivy Bloom
  '#9c2b54', // Raspberry Cane
  '#c45524', // Copper Beech
  '#d2437a', // Foxglove Bell
  '#86915d', // Willow Leaf
  '#e65855', // Rowan Berry
];

// A separate, wider 8-color set used only inside the fan chart, to tell apart the (up
// to) 8 great-great-grandparent branches feeding into ONE person's own pedigree - a
// different job from LINEAGE_PALETTE above (which colors a whole family tree, shown on
// both the map and the tree, and specifically avoids navy/gold for map-only reasons:
// see that constant's own comment). Neither of those reasons applies inside the fan -
// there's no ocean tint and no overlap-star marker in here - so this restores the full
// hedgerow range for exactly this one use.
export const FAN_BRANCH_PALETTE = [
  '#40654a', // Ivy Bloom
  '#9c2b54', // Raspberry Cane
  '#c45524', // Copper Beech
  '#224653', // Blackthorn Berry
  '#d2437a', // Foxglove Bell
  '#86915d', // Willow Leaf
  '#e65855', // Rowan Berry
  '#c4a524', // Gorse Bloom
];

// Once every color above is already in use, later lineages just wrap back around and
// reuse one - six trees, each unmistakably its own color, comfortably covers this
// app's actual usage (a handful of paper trails on one map), so there's no need for a
// cleverer scheme just to keep assigning distinct-ish colors past that.
export function nextLineageColor(existingLineages) {
  const used = new Set(Object.values(existingLineages).map((l) => l.color));
  const free = LINEAGE_PALETTE.find((c) => !used.has(c));
  if (free) return free;
  const n = Object.keys(existingLineages).length;
  return LINEAGE_PALETTE[n % LINEAGE_PALETTE.length];
}
