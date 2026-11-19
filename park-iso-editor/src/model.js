// 物体类型定义:尺寸(米)、颜色、默认参数
export const TYPES = {
  station: {
    name: '监测微站',
    w: 3, d: 2.4, h: 2.8,
    color: '#4f8ef7',
    params: { 监测因子: 'SO2/NO2/PM2.5/PM10', 量程: '0-500 μg/m³', 功率: '120 W', 通讯: '4G/光纤' },
  },
  probe: {
    name: '采样探头',
    w: 0.4, d: 0.4, h: 3.5,
    color: '#f7a24f',
    params: { 采样高度: '3.5 m', 流量: '16.7 L/min', 伴热温度: '120 ℃' },
  },
  fence: {
    name: '围栏',
    w: 6, d: 0.15, h: 1.2,
    color: '#9aa7b4',
    params: { 材质: 'PVC 塑钢', 高度: '1.2 m' },
  },
  cabinet: {
    name: '机柜',
    w: 0.8, d: 0.6, h: 1.8,
    color: '#6fcf97',
    params: { 防护等级: 'IP55', 电源: '220 VAC' },
  },
};

export const TYPE_KEYS = Object.keys(TYPES);
