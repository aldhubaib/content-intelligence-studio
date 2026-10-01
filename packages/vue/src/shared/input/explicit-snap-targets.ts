import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'
import { getWorldMatrix } from '@open-pencil/scene-graph/coordinate'
import { layoutGuideLines } from '@open-pencil/scene-graph/layout-guides'
import Matrix from '@open-pencil/scene-graph/matrix'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import type { ExplicitSnapTarget } from '#vue/shared/input/snap'

/** Page guides are in canvas space. A guide pulled from the ruler onto a frame is stored on that frame, in the frame's local space, and has to be mapped into the world before an object can snap to it. */
function guideTargets(owner: SceneNode, editor: Editor): ExplicitSnapTarget[] {
  if (owner.guides.length === 0) return []
  if (owner.type === 'CANVAS') {
    return owner.guides.map((guide) => ({
      kind: 'canvas-guide',
      axis: guide.axis,
      position: guide.position,
      from: -1e6,
      to: 1e6
    }))
  }
  const matrix = getWorldMatrix(owner, editor.graph)
  return owner.guides.flatMap((guide) => {
    const start = Matrix.mapPoint(
      matrix,
      guide.axis === 'x' ? { x: guide.position, y: 0 } : { x: 0, y: guide.position }
    )
    const end = Matrix.mapPoint(
      matrix,
      guide.axis === 'x'
        ? { x: guide.position, y: owner.height }
        : { x: owner.width, y: guide.position }
    )
    const target = axisAlignedTarget(start, end)
    return target ? [{ ...target, kind: 'canvas-guide' as const }] : []
  })
}

const AXIS_ALIGNMENT_EPSILON = 1e-6

function axisAlignedTarget(start: Vector, end: Vector): ExplicitSnapTarget | null {
  const dx = Math.abs(end.x - start.x)
  const dy = Math.abs(end.y - start.y)
  if (dx <= AXIS_ALIGNMENT_EPSILON) {
    return {
      kind: 'layout-guide',
      axis: 'x',
      position: start.x,
      from: Math.min(start.y, end.y),
      to: Math.max(start.y, end.y)
    }
  }
  if (dy <= AXIS_ALIGNMENT_EPSILON) {
    return {
      kind: 'layout-guide',
      axis: 'y',
      position: start.y,
      from: Math.min(start.x, end.x),
      to: Math.max(start.x, end.x)
    }
  }
  return null
}

function layoutGuideTargets(parent: SceneNode, editor: Editor): ExplicitSnapTarget[] {
  const matrix = getWorldMatrix(parent, editor.graph)
  return parent.layoutGrids.flatMap((grid) =>
    layoutGuideLines(parent, grid).flatMap((line) => {
      const start = Matrix.mapPoint(
        matrix,
        line.axis === 'x' ? { x: line.position, y: 0 } : { x: 0, y: line.position }
      )
      const end = Matrix.mapPoint(
        matrix,
        line.axis === 'x'
          ? { x: line.position, y: parent.height }
          : { x: parent.width, y: line.position }
      )
      const target = axisAlignedTarget(start, end)
      return target ? [target] : []
    })
  )
}

export function explicitSnapTargets(parentId: string | null | undefined, editor: Editor) {
  const parent = parentId ? editor.graph.getNode(parentId) : undefined
  const page = editor.graph.getNode(editor.state.currentPageId)
  const owners = [page, parent && parent !== page ? parent : undefined].filter(
    (node): node is SceneNode => node != null
  )
  return [
    ...owners.flatMap((owner) => guideTargets(owner, editor)),
    ...(parent && !editor.isTopLevel(parent.id) ? layoutGuideTargets(parent, editor) : [])
  ]
}
