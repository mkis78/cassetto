// Quick arrangements, like Windows' snap layouts: the open tabs rearranged into a grid of panels.
// Works on dockview's toJSON()/fromJSON() shape, so it is plain data in and out.

// a cell, or a split (the root must be one); a split's direction alternates with depth, starting from the root's
type Node = 'cell' | Node[]
export const PRESETS = {
  one: { label: 'Un pannello', vertical: false, tree: ['cell'] }, // the root is always a split, even of one
  two: { label: 'Due affiancati', vertical: false, tree: ['cell', 'cell'] },
  stacked: { label: 'Due sovrapposti', vertical: true, tree: ['cell', 'cell'] },
  three: { label: 'Tre affiancati', vertical: false, tree: ['cell', 'cell', 'cell'] },
  mainSide: { label: 'Uno grande e due a destra', vertical: false, tree: ['cell', ['cell', 'cell']] },
  grid: { label: 'Griglia 2×2', vertical: false, tree: [['cell', 'cell'], ['cell', 'cell']] }
} satisfies Record<string, { label: string; vertical: boolean; tree: Node }>
export type Preset = keyof typeof PRESETS

interface Leaf { type: 'leaf'; data: { views: string[]; activeView?: string; id: string }; size: number }
interface Branch { type: 'branch'; data: GridNode[]; size: number }
type GridNode = Leaf | Branch
export interface Layout {
  grid: { root: GridNode; width: number; height: number; orientation: 'HORIZONTAL' | 'VERTICAL' }
  panels: Record<string, { id: string; params?: Record<string, unknown>; [k: string]: unknown }>
  activeGroup?: string
}

const cells = (n: Node): number => (n === 'cell' ? 1 : n.reduce((s, c) => s + cells(c), 0))

// the panel ids in the order the layout shows them, group by group
function order(n: GridNode): string[] {
  return n.type === 'leaf' ? n.data.views : n.data.flatMap(order)
}

// `layout` rearranged as `preset`; `active` is the tab in front (its cell is the active one, new tabs copy its folder).
// Tabs fill the cells in order; extra tabs go into the last cell, missing ones are opened with `newId`.
export function arrange(layout: Layout, preset: Preset, active: string | undefined, newId: () => string): Layout {
  const { tree, vertical } = PRESETS[preset]
  const ids = order(layout.grid.root).filter(id => layout.panels[id])
  const panels = { ...layout.panels }
  const model = panels[active ?? ''] ?? panels[ids[0]]
  while (ids.length < cells(tree) && model) {
    const id = newId()
    // a fresh tab on the same folder and view; not the copied tab's own name or colour
    const { name: _n, color: _c, ...params } = model.params ?? {}
    panels[id] = { ...model, id, params, title: model.title }
    ids.push(id)
  }
  const n = cells(tree)
  const groups = Array.from({ length: n }, (_, i) => (i < n - 1 ? ids.slice(i, i + 1) : ids.slice(i)))
  let next = 0
  let activeGroup: string | undefined
  // size: along the parent's direction; other: across it
  const build = (node: Node, size: number, other: number): GridNode => {
    if (node === 'cell') {
      const views = groups[next]
      const id = String(++next)
      const activeView = views.includes(active ?? '') ? active : views[0]
      if (views.includes(active ?? '')) activeGroup = id
      return { type: 'leaf', data: { views, activeView, id }, size }
    }
    return { type: 'branch', data: node.map(c => build(c, other / node.length, size)), size }
  }
  const { width, height } = layout.grid
  const root = build(tree, vertical ? width : height, vertical ? height : width)
  return { ...layout, grid: { ...layout.grid, root, orientation: vertical ? 'VERTICAL' : 'HORIZONTAL' }, panels, activeGroup: activeGroup ?? '1' }
}
