import type { LayerId, LayerMeta } from './types';

/**
 * 七个业务图层：塔架、导流槽、加注区、避雷塔、警戒线、消防通道、摄像点位。
 * minLod 控制概览级别下哪些图层参与绘制；clusterable 控制点要素是否聚合。
 */
export const LAYER_METAS: LayerMeta[] = [
  {
    id: 'fueling',
    name: '加注区',
    kind: 'polygon',
    color: '#d97706',
    fill: 'rgba(217,119,6,0.18)',
    minLod: 1,
    clusterable: false,
  },
  {
    id: 'diversion',
    name: '导流槽',
    kind: 'polygon',
    color: '#0891b2',
    fill: 'rgba(8,145,178,0.18)',
    minLod: 1,
    clusterable: false,
  },
  {
    id: 'firelane',
    name: '消防通道',
    kind: 'line',
    color: '#dc2626',
    minLod: 0,
    clusterable: false,
  },
  {
    id: 'cordon',
    name: '警戒线',
    kind: 'line',
    color: '#ca8a04',
    minLod: 0,
    clusterable: false,
  },
  {
    id: 'tower',
    name: '塔架',
    kind: 'point',
    color: '#7c3aed',
    minLod: 0,
    clusterable: true,
  },
  {
    id: 'lightning',
    name: '避雷塔',
    kind: 'point',
    color: '#2563eb',
    minLod: 0,
    clusterable: true,
  },
  {
    id: 'camera',
    name: '摄像点位',
    kind: 'point',
    color: '#059669',
    minLod: 2,
    clusterable: true,
  },
];

export const LAYER_MAP: Record<LayerId, LayerMeta> = Object.fromEntries(
  LAYER_METAS.map((m) => [m.id, m]),
) as Record<LayerId, LayerMeta>;

/** 世界坐标范围（米），模拟发射场场区 4km × 3km */
export const WORLD = { width: 4000, height: 3000 };

/** 四级 LOD 的比例尺阈值（世界米/像素），低于阈值进入更细一级 */
export const LOD_SCALE_BREAKS = [2.2, 1.1, 0.55]; // scale(px per meter) 分界

/** 根据每米像素数选择 LOD：0 概览（最小比例尺）→ 3 最详细 */
export function lodForScale(pxPerMeter: number): number {
  if (pxPerMeter <= LOD_SCALE_BREAKS[2]!) return 0;
  if (pxPerMeter <= LOD_SCALE_BREAKS[1]!) return 1;
  if (pxPerMeter <= LOD_SCALE_BREAKS[0]!) return 2;
  return 3;
}
