# 档案库数据格式 (version 1)

「导出档案库」输出的 JSON 顶层结构：

```jsonc
{
  "version": 1,
  "archives": [ ArchiveRecord, ... ],
  "versions": [ VersionRecord, ... ],
  "locks":    [ LockRecord, ... ],
  "counter":  11            // 编号序号计数器, 保证编号不重复
}
```

## ArchiveRecord — 编号档案

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 内部 ID |
| `code` | string | 档案编号 `TC-年份-区域代号-序号` |
| `name` | string | 成果名称 |
| `year` | number | 调查年份（检索用） |
| `region` | string | 区域 / 岸段（检索用） |
| `surveyor` | string | 调查单位 |
| `observedAt` | string | 观测日期 `YYYY-MM-DD` |
| `status` | `"draft" \| "archived"` | 归档状态 |
| `notes` | string | 备注 |
| `params` | NetworkParams | 生成参数快照 |
| `fingerprint` | string | 8 位参数+几何指纹 |
| `stats` | object | 总长、节点数、密度、沟头高程范围、曲折度 |
| `levelCounts` | `{"1","2","3"}` | 各级沟道条数（按沟级别检索用） |
| `lockCount` | number | 锁定段数量 |
| `basemap` | BasemapRef \| null | 航拍底图配准信息 |
| `createdAt` / `updatedAt` | ISO 8601 | 时间戳 |

### BasemapRef

```jsonc
{
  "name": "aerial-2026-0417.png",
  "src": "data:image/jpeg;base64,...",   // 缩略图 (档案展示用)
  "world": { "minX": -30, "minY": -30, "maxX": 1501, "maxY": 1516 },  // 图像覆盖的世界范围 (m)
  "pixel": { "width": 4000, "height": 3000 },
  "opacity": 0.72,
  "flightCode": "2026-0417"
}
```

## VersionRecord — 历史版本

```jsonc
{
  "id": "ver_...",
  "archiveId": "arc_...",
  "label": "版本 2 · fbd75436",
  "createdAt": "2026-11-20T02:10:00.000Z",
  "fingerprint": "fbd75436",
  "params": { ... },
  "stats": { "totalLength": 13640, "counts": {...}, "junctionCount": 40, "densityKmPerKm2": 7.3 },
  "payload": NetworkPayload
}
```

### NetworkPayload — 完整几何快照

```jsonc
{
  "params": { ... },
  "fingerprint": "fbd75436",
  "generatedAt": "2026-11-20T02:10:00.000Z",
  "creeks": [
    {
      "id": "M1",
      "level": 1,
      "parentId": null,
      "parentU": 0,
      "side": 0,
      "pts": [ x0, y0, x1, y1, ... ],      // 中心线, 米 (x 向东, y 向北)
      "widths": [ w0, w1, ... ],            // 与 pts 逐点对应的沟宽 (m)
      "edited": false                        // 是否被手工编辑过
    }
  ]
}
```

`fromPayload()` 可把快照恢复为可继续编辑的网络；比对视图即用左右两份快照渲染。

## LockRecord — 锁定段

```jsonc
{
  "lockId": "lk_M1_...",
  "archiveId": "arc_...",
  "creekId": "M1",
  "level": 1,
  "parentId": null,
  "parentU": 0,
  "side": 0,
  "relativeAngle": 0,                 // 相对父沟切向的起始转角 (rad)
  "localPts": [ x0, y0, x1, y1, ... ],// 起点为原点、起点切向为 +x 的局部坐标
  "length": 1524.0,
  "mouthWidth": 24.0,
  "widthScale": 1,
  "shapeSignature": "1524.000:a1b2c3d4:513",  // 刚体不变形状签名
  "capturedAt": "2026-11-20T02:00:00.000Z"
}
```

重生成时：新父沟 → 新的汇入点 + 切向 → 对 `localPts` 做刚体变换 → 起点精确落在父沟上。
`shapeSignature` 由逐段长度 (mm) 与逐顶点转角 (μrad) 量化散列而成，
锁定段重建后签名必须完全一致，否则在 `lockReport` 中标记失败。

## 编号规则

`TC-{年份}-{区域代号}-{三位序号}`，区域代号来自内置对照表（如 `江苏中部岸段 → JS-C`），
未知区域取名称中 ASCII 片段，或由名称散列生成稳定的 `R??` 代号。
