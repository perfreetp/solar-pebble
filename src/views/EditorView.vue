<template>
  <div class="editor-view">
    <!-- 顶部状态条 -->
    <header class="ed-head">
      <div class="row g10" style="min-width: 0">
        <button class="btn btn-ghost btn-icon" title="返回接单台" @click="goBack">
          <ArrowLeft :size="15" />
        </button>
        <div class="col" style="min-width: 0">
          <div class="row g8">
            <span class="mono fs-10 t-fg3">{{ order?.code }}</span>
            <StatusPill v-if="order" :status="order.status" />
            <span v-if="order?.reworkCount" class="tag" style="background: var(--red-soft); color: #f08b91">
              返工 {{ order.reworkCount }}
            </span>
            <span v-if="!canEdit" class="tag" style="background: var(--violet-soft); color: #b6a9f0">
              只读
            </span>
            <span v-else-if="dirty" class="tag" style="background: var(--amber-soft); color: var(--amber)">
              未保存
            </span>
            <span v-else-if="lastSaved" class="tag" style="background: transparent; color: var(--fg-4)">
              <Check :size="9" /> {{ lastSavedLabel }}
            </span>
          </div>
          <h1 class="ed-title truncate">{{ order?.title || '加载中…' }}</h1>
        </div>
      </div>

      <div class="row g6">
        <button class="btn btn-sm" title="撤销 (Ctrl+Z)" :disabled="!undoDepth" @click="session.undo()">
          <Undo2 :size="13" />
        </button>
        <button class="btn btn-sm" title="重做 (Ctrl+Shift+Z)" :disabled="!redoDepth" @click="session.redo()">
          <Redo2 :size="13" />
        </button>
        <div class="head-div"></div>
        <button class="btn btn-sm" @click="runCheck">
          <ShieldCheck :size="13" /> 体检
          <span v-if="analysis && !analysis.stale" class="mini-badge" :class="analysis.ok ? 'ok' : 'bad'">
            {{ analysis.ok ? 'OK' : analysis.issues.filter(i=>i.severity==='error').length }}
          </span>
        </button>
        <button class="btn btn-sm" @click="exportOpen = true">
          <FileDown :size="13" /> 导出
        </button>
        <button class="btn btn-sm" title="保存 (Ctrl+S)" :disabled="saving || !session" @click="save">
          <Loader v-if="saving" :size="13" class="spin" />
          <Save v-else :size="13" />
          保存
        </button>
        <button
          v-if="canSubmit"
          class="btn btn-primary btn-sm"
          :disabled="saving"
          @click="submitQc"
        >
          <Send :size="13" /> 提交质检
        </button>
      </div>
    </header>

    <div class="ed-body">
      <!-- 左：工具 + 材质 -->
      <aside class="ed-left">
        <div class="tools">
          <button
            v-for="t in tools"
            :key="t.key"
            class="tool-btn"
            :class="{ on: toolKey === t.key }"
            :title="`${t.label} (${t.hint})`"
            @click="setTool(t.key)"
          >
            <component :is="t.icon" :size="16" :stroke-width="1.8" />
            <span>{{ t.label }}</span>
            <span class="kbd tool-kbd">{{ t.hint }}</span>
          </button>
        </div>

        <div class="presets">
          <div class="track-wide" style="padding: 12px 2px 7px">参数</div>

          <div class="preset-row">
            <span class="fs-11 t-fg3">笔刷</span>
            <div class="segmented grow">
              <button
                v-for="n in [1, 3, 5, 7]"
                :key="n"
                :class="{ on: brushSizeN === n }"
                style="flex: 1; justify-content: center"
                @click="session.brushSize.value = n"
              >{{ n }}</button>
            </div>
          </div>

          <div class="preset-row">
            <span class="fs-11 t-fg3">模式</span>
            <div class="segmented grow">
              <button :class="{ on: !eraseMode }" style="flex: 1; justify-content: center" @click="eraseMode = false">
                放置
              </button>
              <button :class="{ on: eraseMode }" style="flex: 1; justify-content: center" @click="eraseMode = true">
                擦除
              </button>
            </div>
          </div>

          <div class="preset-row">
            <span class="fs-11 t-fg3" style="width: 32px">高度</span>
            <div class="row g4 grow">
              <button
                class="btn btn-sm btn-icon"
                style="width: 24px; height: 24px"
                title="编辑层下移 ( [ )"
                @click="stepLayer(-1)"
              ><Minus :size="12" /></button>
              <div class="layer-num mono">
                Z {{ activeLayerNum }}
                <span class="t-fg3 fs-10">/ {{ layerCountNum }}</span>
              </div>
              <button
                class="btn btn-sm btn-icon"
                style="width: 24px; height: 24px"
                title="编辑层上移 ( ] )"
                @click="stepLayer(1)"
              ><Plus :size="12" /></button>
            </div>
          </div>
        </div>

        <div class="mat-section">
          <div class="row between" style="padding: 12px 2px 7px">
            <span class="track-wide">材质</span>
            <span class="fs-10 mono t-fg3">{{ currentMat?.name }}</span>
          </div>
          <div class="mat-swatch">
            <span class="swatch-big" :style="{ background: currentMat?.color }"></span>
            <div class="col" style="gap: 2px; min-width: 0">
              <span class="fs-11 w-500 truncate">{{ currentMat?.name }}</span>
              <span class="fs-10 t-fg3">{{ groupName(currentMat?.group) }}</span>
            </div>
          </div>
          <div class="mat-scroll scroll">
            <template v-for="g in appState.groups" :key="g.key">
              <div class="mat-group-label">
                <span class="mg-dot" :style="{ background: g.color }"></span>
                {{ g.name }}
                <span class="fs-9 t-fg4">{{ g.short }}</span>
              </div>
              <div class="mat-grid">
                <button
                  v-for="m in materialsOf(g.key)"
                  :key="m.id"
                  class="mat-tile"
                  :class="{ on: brushMatId === m.id }"
                  :title="`${m.name} #${m.id}`"
                  :style="{ '--mc': m.color }"
                  @click="pickMat(m.id)"
                >
                  <span class="mat-chip"></span>
                  <span class="mat-num mono">{{ m.id }}</span>
                  <span v-if="m.emissive" class="mat-emis"></span>
                </button>
              </div>
            </template>
          </div>
        </div>
      </aside>

      <!-- 中：3D 视口 -->
      <section class="viewport-wrap">
        <div class="viewport" :class="`tool-${toolKey}`">
          <canvas
            ref="canvasEl"
            class="gl-canvas"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointerleave="onPointerLeave"
            @contextmenu.prevent
            @wheel.prevent="onWheel"
          ></canvas>

          <!-- 视口 HUD -->
          <div class="hud hud-tl">
            <div class="hud-box">
              <span class="hud-k">网格</span>
              <span class="hud-v mono">{{ grid.sizeX }}×{{ grid.sizeY }}×{{ grid.sizeZ }}</span>
            </div>
            <div class="hud-box">
              <span class="hud-k">体素</span>
              <span class="hud-v mono">{{ (session?.stats?.total || 0).toLocaleString('zh-CN') }}</span>
            </div>
            <div class="hud-box">
              <span class="hud-k">尺寸</span>
              <span class="hud-v mono">{{ dimsLabel }}</span>
            </div>
          </div>

          <div class="hud hud-tr">
            <div class="segmented view-seg">
              <button :class="{ on: viewMode === 'iso' }" title="等轴测" @click="setView('iso')">ISO</button>
              <button :class="{ on: viewMode === 'top' }" title="俯视" @click="setView('top')">TOP</button>
              <button :class="{ on: viewMode === 'side' }" title="侧视" @click="setView('side')">SIDE</button>
            </div>
            <button class="btn btn-sm btn-icon" title="框选全部 (F)" @click="frameAll"><Maximize2 :size="13" /></button>
            <button class="btn btn-sm btn-icon" :class="{ 'btn-teal': shading === 'layers' }" title="分层着色" @click="cycleShading">
              <Layers3 :size="13" />
            </button>
          </div>

          <!-- 坐标 / 状态 -->
          <div class="hud hud-bl">
            <span v-if="cursor.valid" class="coord mono">
              X <b>{{ cursor.x }}</b> Y <b>{{ cursor.y }}</b> Z <b>{{ cursor.z }}</b>
            </span>
            <span v-else class="coord mono t-fg4">指针在模型外</span>
            <span v-if="hoverMat" class="hover-mat">
              <i :style="{ background: hoverMat.color }"></i>
              {{ hoverMat.name }}
              <span class="fs-9 t-fg4 mono">#{{ hoverMat.id }}</span>
            </span>
            <span class="hud-sep"></span>
            <span class="mono fs-10 t-fg3">{{ statusText }}</span>
          </div>

          <div class="hud hud-br">
            <span v-if="mirrorOn" class="mirror-flag"><FlipHorizontal2 :size="11" /> 镜像轴 X={{ mirrorPlane }}</span>
            <span v-if="focusOn" class="mirror-flag" style="background: rgba(95,168,216,.16); color: #8cc6ea">
              <Eye :size="11" /> 聚焦 Z{{ layerMin }}–{{ layerMax }}
            </span>
            <span v-if="selection.active" class="mirror-flag" style="background: rgba(79,195,173,.16); color: #8fe7d5">
              <SquaresIntersect :size="11" /> 选区 {{ selection.count.toLocaleString('zh-CN') }}
            </span>
          </div>

          <!-- 选中悬浮工具栏 -->
          <transition name="toolpop">
            <div v-if="selection.active && selection.count" class="sel-toolbar">
              <span class="fs-11 t-fg2">选区 <b class="mono">{{ selection.count.toLocaleString('zh-CN') }}</b></span>
              <div class="st-div"></div>
              <button class="st-btn" title="复制 (Ctrl+C)" @click="copySel"><Copy :size="13" /></button>
              <button class="st-btn" title="剪切 (Ctrl+X)" @click="cutSel"><Scissors :size="13" /></button>
              <button class="st-btn" title="粘贴到选区锚点 (Ctrl+V)" @click="pasteAtSel"><ClipboardPaste :size="13" /></button>
              <div class="st-div"></div>
              <button class="st-btn" title="用当前材质填充" @click="fillSel"><PaintBucket :size="13" /></button>
              <button class="st-btn" title="只填空气（灌浆）" @click="fillAir"><Droplets :size="13" /></button>
              <button class="st-btn" title="阵列复制" @click="arrayOpen = true"><Rows3 :size="13" /></button>
              <button class="st-btn danger" title="删除选区 (Del)" @click="delSel"><Trash2 :size="13" /></button>
              <div class="st-div"></div>
              <button class="st-btn" title="取消选择 (Esc)" @click="clearSel"><X :size="13" /></button>
            </div>
          </transition>

          <!-- 加载遮罩 -->
          <div v-if="loading" class="vp-loading">
            <Loader :size="22" class="spin" />
            <span class="fs-12">正在载入体素模型…</span>
          </div>

          <!-- WebGL 不可用 -->
          <div v-if="glError" class="vp-loading vp-error">
            <TriangleAlert :size="22" />
            <span class="fs-13 w-500">{{ glError }}</span>
          </div>
        </div>

        <!-- 底部：层条 -->
        <div class="layerbar">
          <div class="lb-head">
            <Layers3 :size="12" />
            <span class="fs-10 track-wide" style="letter-spacing: .08em">Z 轴分层</span>
            <span class="fs-10 t-fg4 mono">1–{{ layerCount }}</span>
          </div>
          <div class="lb-body">
            <button
              class="lb-focus"
              :class="{ on: focusOn }"
              :title="focusOn ? '取消聚焦当前层范围' : '只高亮当前层范围'"
              @click="toggleFocus"
            >
              <Eye v-if="focusOn" :size="12" />
              <EyeOff v-else :size="12" />
              <span class="fs-10">{{ focusOn ? '已聚焦' : '聚焦' }}</span>
            </button>
            <div class="lb-strip" @pointerleave="hoverLayer = null">
              <button
                v-for="lv in layerList"
                :key="lv"
                class="lb-cell"
                :class="{
                  inRange: lv >= layerMin && lv <= layerMax,
                  active: lv === activeLayer,
                  locked: lockedLayers.has(lv),
                  soloed: soloLayers.has(lv),
                  hovered: hoverLayer === lv,
                  populated: densityOf(lv) > 0,
                  major: lv % 4 === 0,
                }"
                :style="{ '--d': Math.min(1, densityOf(lv)) }"
                :title="`Z${lv} · ${densityLabel(lv)}（点击设为编辑层，Shift 扩展层范围，Alt 单独显示）`"
                @click="onLayerClick(lv, $event)"
                @pointerenter="hoverLayer = lv"
              >
                <span class="lb-fill"></span>
                <span v-if="lv % labelEvery === 0 || lv === activeLayer || lv === 1" class="lb-num">{{ lv }}</span>
                <Lock v-if="lockedLayers.has(lv)" :size="7" class="lb-lock" />
              </button>
            </div>
            <div class="lb-tools">
              <button class="btn btn-ghost btn-sm" title="全选整个层范围" @click="session.selectAllInLayers()">
                <SquareDashed :size="12" />
              </button>
              <button
                class="btn btn-sm"
                :class="{ 'btn-teal': lockedLayers.has(activeLayer) }"
                title="锁定/解锁当前层 (L)"
                @click="session.toggleLock()"
              >
                <Lock v-if="lockedLayers.has(activeLayer)" :size="12" />
                <Unlock v-else :size="12" />
              </button>
              <div class="lb-visible">
                <span class="fs-10 t-fg3">仅显示</span>
                <input
                  v-model="visibleLayersText"
                  class="input input-mono lb-vis-input"
                  placeholder="如 1-6, 20"
                  :title="'只显示这些层；留空显示全部。也可以 Alt+点层条某层直接单独显示'"
                  @change="applyVisibleLayers"
                  @keydown.enter="applyVisibleLayers"
                />
              </div>
              <button
                v-if="soloLayers.size"
                class="btn btn-sm btn-danger"
                @click="session.clearSolo(); visibleLayersText = ''"
              >
                显示全部
              </button>
            </div>
          </div>
          <div class="lb-hover" v-if="hoverLayer">
            <span class="mono">Z{{ hoverLayer }}</span>
            <span class="t-fg3">{{ densityLabel(hoverLayer) }}</span>
            <span class="t-fg4">·</span>
            <span class="t-fg3">高度 {{ ((hoverLayer - 0.5) * grid.voxelSize).toFixed(1) }} m</span>
            <span v-if="hoverLayer >= layerMin && hoverLayer <= layerMax" class="t-lunar">可编辑</span>
            <span v-else class="t-fg4">范围外</span>
          </div>
          <div class="lb-range">
            <span class="fs-10 t-fg3">可编辑层</span>
            <input
              class="input input-mono lb-num"
              type="number"
              :min="1"
              :max="layerCount"
              :value="layerMin"
              @change="setRange($event.target.value, layerMax)"
            />
            <span class="t-fg4">–</span>
            <input
              class="input input-mono lb-num"
              type="number"
              :min="1"
              :max="layerCount"
              :value="layerMax"
              @change="setRange(layerMin, $event.target.value)"
            />
            <span class="fs-10 t-fg4">共 {{ layerCount }} 层</span>
          </div>
        </div>
      </section>

      <!-- 右：面板 -->
      <aside class="ed-right scroll">
        <!-- 镜像 -->
        <section class="rpanel">
          <div class="rpanel-head">
            <div class="row g6">
              <FlipHorizontal2 :size="12" class="t-fg3" />
              <span class="rpanel-title">镜像对称</span>
            </div>
            <button class="switch" :class="{ on: mirrorOn }" @click="toggleMirror"></button>
          </div>
          <div class="rpanel-body">
            <p class="hint">
              开启后，在轴线一侧搭建会自动在另一侧生成镜像体素。适合舱段、气闸这类对称结构。
            </p>
            <div class="mirror-ctrl" :class="{ disabled: !mirrorOn }">
              <div class="row between">
                <span class="fs-11 t-fg3">对称轴 X</span>
                <span class="mono fs-12" style="color: var(--teal)">{{ mirrorPlane }}</span>
              </div>
              <input
                type="range"
                min="1"
                :max="grid.sizeX - 1"
                :value="mirrorPlane"
                :disabled="!mirrorOn"
                @input="setMirrorPlane($event.target.value)"
              />
              <div class="row between fs-10 t-fg4 mono">
                <span>1</span>
                <span>居中 {{ Math.round(grid.sizeX / 2) }}</span>
                <span>{{ grid.sizeX - 1 }}</span>
              </div>
              <div class="row g4" style="margin-top: 8px">
                <button class="btn btn-sm grow" :disabled="!mirrorOn" @click="setMirrorPlane(grid.sizeX/2)">
                  居中
                </button>
                <button class="btn btn-sm grow" :disabled="!mirrorOn" @click="setMirrorPlane(mirrorPlane - 2)">
                  左移 2
                </button>
                <button class="btn btn-sm grow" :disabled="!mirrorOn" @click="setMirrorPlane(mirrorPlane + 2)">
                  右移 2
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 选区与操作 -->
        <section class="rpanel">
          <div class="rpanel-head">
            <div class="row g6">
              <SquaresIntersect :size="12" class="t-fg3" />
              <span class="rpanel-title">选区</span>
            </div>
            <span class="fs-10 mono t-fg3">{{ selection.count.toLocaleString('zh-CN') }} 格</span>
          </div>
          <div class="rpanel-body">
            <div v-if="!selection.active" class="hint">
              用「框选」工具拖出范围；或在层条上按住 Shift 点两层做整段选择。
            </div>
            <div v-else class="sel-info">
              <div class="sel-bbox mono">
                ({{ selBox.x0 }},{{ selBox.y0 }},{{ selBox.z0 }})
                →
                ({{ selBox.x1 }},{{ selBox.y1 }},{{ selBox.z1 }})
              </div>
              <div class="sel-dim">
                {{ selBox.x1 - selBox.x0 + 1 }} × {{ selBox.y1 - selBox.y0 + 1 }} × {{ selBox.z1 - selBox.z0 + 1 }}
              </div>
            </div>

            <div class="act-grid">
              <button class="act" :disabled="!selection.active" @click="copySel">
                <Copy :size="13" /><span>复制</span>
              </button>
              <button class="act" :disabled="!selection.active" @click="cutSel">
                <Scissors :size="13" /><span>剪切</span>
              </button>
              <button class="act" :disabled="!clipboard" @click="pasteAtCursor">
                <ClipboardPaste :size="13" /><span>粘贴</span>
              </button>
              <button class="act" :disabled="!clipboard" @click="arrayOpen = true">
                <Rows3 :size="13" /><span>阵列</span>
              </button>
            </div>

            <div v-if="clipboard" class="clip-info">
              <Clipboard :size="11" />
              剪贴板 {{ clipboard.count.toLocaleString('zh-CN') }} 格 · {{ clipboard.size.join('×') }}
            </div>

            <div class="fill-row">
              <span class="fs-11 t-fg3 shrink">填充</span>
              <button class="btn btn-sm grow" :disabled="!selection.active" @click="fillSel">
                <PaintBucket :size="11" /> 实心
              </button>
              <button class="btn btn-sm grow" :disabled="!selection.active" @click="fillAir">
                <Droplets :size="11" /> 仅空气
              </button>
            </div>

            <div class="fill-row">
              <span class="fs-11 t-fg3 shrink">替换</span>
              <select v-model="replaceFrom" class="select" style="height: 26px; font-size: 11px">
                <option value="any">所有材质</option>
                <option v-for="g in appState.groups" :key="g.key" :value="`group:${g.key}`">
                  {{ g.name }}组
                </option>
                <option v-for="m in appState.materials" :key="m.id" :value="m.id">
                  {{ m.name }}
                </option>
              </select>
              <ArrowRight :size="11" class="t-fg4" />
              <select class="select" style="height: 26px; font-size: 11px" :value="brushMatId" @change="pickMat(+$event.target.value)">
                <option v-for="m in appState.materials" :key="m.id" :value="m.id">{{ m.name }}</option>
              </select>
              <button class="btn btn-sm" @click="doReplace" title="按颜色替换材质">
                <Replace :size="11" />
              </button>
            </div>
          </div>
        </section>

        <!-- 体检 -->
        <section class="rpanel">
          <div class="rpanel-head">
            <div class="row g6">
              <ShieldCheck :size="12" :class="analysisBadge.cls" />
              <span class="rpanel-title">合并前体检</span>
            </div>
            <button class="btn btn-ghost btn-sm" @click="runCheck" :disabled="checking">
              <RefreshCw :size="11" :class="{ spin: checking }" /> 重查
            </button>
          </div>
          <div class="rpanel-body">
            <div class="check-params">
              <label class="cp-item">
                <span class="fs-11 t-fg3">悬空阈值</span>
                <div class="row g4">
                  <span class="fs-10 t-fg4">&gt;</span>
                  <input
                    v-model.number="params.floatingMin"
                    class="input input-mono cp-num"
                    type="number"
                    min="1"
                    max="100"
                    @change="rerunIfChecked"
                  />
                  <span class="fs-10 t-fg3">格</span>
                </div>
              </label>
              <label class="cp-item">
                <span class="fs-11 t-fg3">薄壁阈值</span>
                <div class="row g4">
                  <span class="fs-10 t-fg4">&lt;</span>
                  <input
                    v-model.number="params.minWall"
                    class="input input-mono cp-num"
                    type="number"
                    min="2"
                    max="20"
                    @change="rerunIfChecked"
                  />
                  <span class="fs-10 t-fg3">格</span>
                </div>
              </label>
            </div>

            <div v-if="!analysis" class="hint" style="margin-top: 10px">
              还没体检。点上方「体检」或表头的按钮，检查悬空体素簇与薄壁。
            </div>

            <template v-else>
              <div v-if="analysis.stale" class="stale-flag">
                <AlertTriangle :size="11" /> 模型已改动，结果可能过期
              </div>
              <div class="verdict" :class="analysis.ok ? 'ok' : 'bad'">
                <component :is="analysis.ok ? CheckCircle2 : XOctagon" :size="15" />
                <div class="col" style="gap: 1px">
                  <span class="fs-12.5 w-600">{{ analysis.ok ? '可合并' : '存在问题，先处理后合并' }}</span>
                  <span class="fs-10" style="opacity: .75">
                    {{ analysis.cells?.toLocaleString('zh-CN') }} 格 · {{ analysis.stats.total.toLocaleString('zh-CN') }} 占用
                  </span>
                </div>
              </div>

              <div class="issue-cards">
                <div
                  v-for="iss in analysis.issues"
                  :key="iss.code"
                  class="issue-card"
                  :class="iss.severity"
                >
                  <div class="row g6">
                    <span class="issue-mark" :class="iss.severity"></span>
                    <span class="fs-11.5 w-600">{{ iss.title }}</span>
                    <span class="grow"></span>
                    <span class="mono fs-10 t-fg3">{{ iss.count }} 处</span>
                  </div>
                  <p class="issue-desc">{{ iss.detail }}</p>
                </div>
                <div v-if="!analysis.issues.length" class="issue-card info">
                  <span class="fs-11.5 t-green">未发现悬空体素簇或薄壁，可以去合并导出了。</span>
                </div>
              </div>

              <div v-if="analysis.floating?.length" class="locate-list">
                <div class="track-wide" style="padding-bottom: 6px">悬空簇定位</div>
                <button
                  v-for="(f, i) in analysis.floating.slice(0, 6)"
                  :key="i"
                  class="locate-item error"
                  @click="focusBox(f.bbox)"
                >
                  <span class="loc-dot error"></span>
                  <span class="fs-11">{{ f.count }} 格</span>
                  <span class="mono fs-10 t-fg3">
                    ({{ f.bbox.x0 }},{{ f.bbox.y0 }},{{ f.bbox.z0 }})
                  </span>
                  <span class="grow"></span>
                  <Crosshair :size="10" class="t-fg3" />
                </button>
                <div v-if="analysis.floating.length > 6" class="fs-10 t-fg4" style="padding: 3px 0">
                  仅显示最大的 6 个，共 {{ analysis.floating.length }} 个
                </div>
              </div>

              <div v-if="analysis.thinAreas?.length" class="locate-list">
                <div class="track-wide" style="padding-bottom: 6px">薄壁区域定位</div>
                <button
                  v-for="(t, i) in analysis.thinAreas.slice(0, 6)"
                  :key="i"
                  class="locate-item warn"
                  @click="focusBox(t.bbox)"
                >
                  <span class="loc-dot warn"></span>
                  <span class="fs-11">{{ t.count }} 格 · 最薄 {{ t.minThickness }}</span>
                  <span class="grow"></span>
                  <Crosshair :size="10" class="t-fg3" />
                </button>
                <div v-if="analysis.thinAreas.length > 6" class="fs-10 t-fg4" style="padding: 3px 0">
                  显示前 6 处，共 {{ analysis.thinTotal }} 处
                </div>
              </div>
            </template>
          </div>
        </section>

        <!-- 要求 -->
        <section class="rpanel">
          <div class="rpanel-head">
            <div class="row g6">
              <ListChecks :size="12" class="t-fg3" />
              <span class="rpanel-title">建模要求</span>
            </div>
          </div>
          <div class="rpanel-body">
            <div v-for="(r, i) in order?.requirements || []" :key="i" class="req-mini">
              <span class="req-mini-k">{{ r.k }}</span>
              <span class="req-mini-v">{{ r.v }}</span>
            </div>
            <p v-if="order?.brief" class="brief-mini">{{ order.brief }}</p>
          </div>
        </section>

        <!-- 快捷键 -->
        <section class="rpanel">
          <div class="rpanel-head">
            <div class="row g6">
              <Keyboard :size="12" class="t-fg3" />
              <span class="rpanel-title">快捷键</span>
            </div>
          </div>
          <div class="rpanel-body keys">
            <div><span class="kbd">B</span><span class="kbd">E</span><span>放置 / 擦除</span></div>
            <div><span class="kbd">S</span><span>框选</span></div>
            <div><span class="kbd">I</span><span>吸取材质</span></div>
            <div><span class="kbd">M</span><span>镜像开关</span></div>
            <div><span class="kbd">F</span><span>框住全部</span></div>
            <div><span class="kbd">[</span><span class="kbd">]</span><span>上下层</span></div>
            <div><span class="kbd">L</span><span>锁定当前层</span></div>
            <div><span class="kbd">Esc</span><span>取消选区</span></div>
          </div>
        </section>
      </aside>
    </div>

    <ArrayModal
      v-if="arrayOpen"
      :selection="selection"
      :clipboard="clipboard"
      @close="arrayOpen = false"
      @confirm="doArray"
    />
    <ExportModal
      v-if="exportOpen"
      :order-id="orderId"
      :session="session"
      @close="exportOpen = false"
      @exported="onExported"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft, Undo2, Redo2, ShieldCheck, FileDown, Save, Send, Loader, Check,
  Boxes, Eraser, SquareDashed, MousePointer2, Pipette, Plus, Minus,
  Layers3, FlipHorizontal2, Eye, EyeOff, Lock, Unlock, Copy, Scissors,
  ClipboardPaste, PaintBucket, Droplets, Rows3, Trash2, X, Maximize2,
  SquareDashed as SquaresIntersect, ArrowRight, Replace, RefreshCw,
  AlertTriangle, CheckCircle2, XOctagon, Crosshair, Clipboard, ListChecks, Keyboard,
  TriangleAlert,
} from 'lucide-vue-next';
import {
  appState, apiClient, toast,
} from '../state.js';
import { EditorSession } from '../editor/EditorSession.js';
import { VoxelModel } from '../../shared/voxel.js';
import StatusPill from '../components/StatusPill.vue';
import ArrayModal from '../components/ArrayModal.vue';
import ExportModal from '../components/ExportModal.vue';

const route = useRoute();
const router = useRouter();
const orderId = computed(() => route.params.id);

const canvasEl = ref(null);
const session = shallowRef(null);
const order = ref(null);
const loading = ref(true);
const saving = ref(false);
const glError = ref('');
const lastSaved = ref(null);
const dirty = ref(false);
const eraseMode = ref(false);
const arrayOpen = ref(false);
const exportOpen = ref(false);
const replaceFrom = ref('any');
const viewMode = ref('iso');
const shading = ref('material');
const hoverLayer = ref(null);

const params = reactive({ floatingMin: 5, minWall: 2 });

const tools = [
  { key: 'build', label: '放置', icon: Boxes, hint: 'B' },
  { key: 'erase', label: '擦除', icon: Eraser, hint: 'E' },
  { key: 'select', label: '框选', icon: SquareDashed, hint: 'S' },
  { key: 'pick', label: '吸取', icon: Pipette, hint: 'I' },
  { key: 'pan', label: '平移', icon: MousePointer2, hint: '空格' },
];

// 从 session 派生的只读状态
const grid = computed(() => (session.value ? session.value.grid : { sizeX: 0, sizeY: 0, sizeZ: 0, voxelSize: 0.5 }));
const layerCount = computed(() => session.value?.layerCount.value || 0);
const layerMin = computed(() => session.value?.layerMin.value || 1);
const layerMax = computed(() => session.value?.layerMax.value || 1);
const activeLayer = computed(() => session.value?.activeLayer.value || 1);
const lockedLayers = computed(() => session.value?.lockedLayers.value || new Set());
const soloLayers = computed(() => session.value?.soloLayers.value || new Set());
const mirrorOn = computed(() => session.value?.mirror.enabled || false);
const mirrorPlane = computed(() => session.value?.mirror.plane || 0);
const focusOn = computed(() => session.value?.focusLayers.value || false);
const selection = computed(() => session.value?.selection || { active: false, count: 0 });
const clipboard = computed(() => session.value?.clipboard.value || null);
const analysis = computed(() => session.value?.analysis.value || null);
const checking = computed(() => session.value?.checking.value || false);
const statusText = computed(() => session.value?.statusText.value || '');
const cursor = computed(() => session.value?.cursor || { valid: false });
const currentMat = computed(() => appState.materials.find((m) => m.id === (session.value?.brushMat.value ?? 0)));

// 模板里直接用的标量（避免在空 session 上访问 .value）
const undoDepth = computed(() => session.value?.undoDepth.value || 0);
const redoDepth = computed(() => session.value?.redoDepth.value || 0);
const toolKey = computed(() => session.value?.tool.value || 'build');
const brushSizeN = computed(() => session.value?.brushSize.value || 1);
const brushMatId = computed(() => session.value?.brushMat.value || 1);
const activeLayerNum = computed(() => session.value?.activeLayer.value || 1);
const layerCountNum = computed(() => session.value?.layerCount.value || 0);

const labelEvery = computed(() => (layerCount.value > 64 ? 8 : layerCount.value > 32 ? 4 : 2));

const layerList = computed(() => {
  const n = layerCount.value;
  const out = [];
  for (let i = 1; i <= n; i++) out.push(i);
  return out;
});

const selBox = computed(() => session.value ? session.value.normalizeSelection() || {
  x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0,
} : { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 });

const dimsLabel = computed(() => {
  const g = grid.value;
  return `${(g.sizeX * g.voxelSize).toFixed(0)}×${(g.sizeY * g.voxelSize).toFixed(0)}×${(g.sizeZ * g.voxelSize).toFixed(0)} m`;
});

const visibleLayersText = ref('');

// 悬停材质存在响应式 cursor 里（renderer 上的状态不是响应式的）
const hoverMat = computed(() => {
  const c = session.value?.cursor;
  if (!c || !c.mat) return null;
  return appState.materials.find((m) => m.id === c.mat) || null;
});

function parseLayerList(text) {
  const out = new Set();
  for (const part of String(text).split(/[,，\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)\s*[-–~]\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    } else if (/^\d+$/.test(part)) {
      out.add(Number(part));
    }
  }
  return [...out].sort((a, b) => a - b);
}

function applyVisibleLayers() {
  const s = session.value;
  if (!s) return;
  const list = parseLayerList(visibleLayersText.value);
  if (!list.length) {
    s.clearSolo();
    toast('已恢复显示全部层', 'ok', 1800);
    return;
  }
  const n = s.setVisibleLayers(list);
  toast(n ? `仅显示 ${n} 层（其余隐藏）` : '没有合法的层号', n ? 'ok' : 'warn', 2200);
}

const lastSavedLabel = computed(() => {
  if (!lastSaved.value) return '';
  const d = new Date(lastSaved.value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} 已保存`;
});

const analysisBadge = computed(() => {
  const a = analysis.value;
  if (!a) return { cls: 't-fg4' };
  if (a.stale) return { cls: 't-amber' };
  return { cls: a.ok ? 't-green' : 't-red' };
});

const canEdit = computed(
  () => order.value && (order.value.assignee === appState.me?.id || appState.me?.role === 'admin')
);

const canSubmit = computed(
  () => canEdit.value && ['building', 'rejected'].includes(order.value?.status || '')
);

function materialsOf(groupKey) {
  return appState.materials.filter((m) => m.group === groupKey);
}

function groupName(key) {
  return appState.groups.find((g) => g.key === key)?.name || '';
}

function densityOf(lv) {
  const s = session.value;
  if (!s || !s.layerDensity) return 0;
  return s.layerDensity[lv] || 0;
}

function densityLabel(lv) {
  const n = densityOf(lv);
  if (!n) return '空';
  return `${Math.round(n * 100)}% 填充`;
}

// ---------------------------------------------------------------- 初始化

async function boot() {
  loading.value = true;
  glError.value = '';
  try {
    const [detail, modelPayload] = await Promise.all([
      apiClient.order(orderId.value),
      apiClient.model(orderId.value),
    ]);
    order.value = detail;
    await nextTick();
    let model;
    try {
      model = VoxelModel.fromJSON(modelPayload.data);
    } catch (err) {
      throw new Error('模型数据解析失败：' + err.message);
    }
    const s = new EditorSession(canvasEl.value);
    s.params.floatingMin = 5;
    s.params.minWall = 2;
    s.setModel(model, detail);
    session.value = s;
    computeLayerDensity();
    s.renderer.render();

    // 初次进入自动体检一次（不阻塞界面）
    setTimeout(() => {
      runCheck(true);
    }, 120);
  } catch (err) {
    glError.value = err.message;
    console.error(err);
  } finally {
    loading.value = false;
  }
}

let densityTimer = null;
function computeLayerDensity() {
  clearTimeout(densityTimer);
  densityTimer = setTimeout(() => {
    const s = session.value;
    const m = s?.model.value;
    if (!m) return;
    const counts = new Float32Array(m.sizeZ + 1);
    const area = m.sizeX * m.sizeY;
    m.forEach((x, y, z) => {
      counts[z + 1]++;
    });
    const out = {};
    for (let lv = 1; lv <= m.sizeZ; lv++) out[lv] = counts[lv] / area;
    s.layerDensity = out;
    // 触发一次响应式刷新
    layerDensityTick.value++;
  }, 180);
}
const layerDensityTick = ref(0);
watch(layerDensityTick, () => {});

// ---------------------------------------------------------------- 视口交互

let dragging = null;

function canvasPoint(e) {
  const rect = canvasEl.value.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e) {
  const s = session.value;
  if (!s) return;
  if (!canEdit.value && !e.shiftKey && !e.altKey && e.button !== 1 && e.button !== 2) {
    toast('当前身份不是该单的承接人，视图为只读。可在右上角切换操作人。', 'warn', 3800);
    return;
  }
  canvasEl.value.setPointerCapture(e.pointerId);
  const p = canvasPoint(e);
  const wantPan = e.button === 1 || e.button === 2 || e.shiftKey || e.altKey || s.tool.value === 'pan';
  dragging = {
    mode: wantPan ? (e.button === 2 || e.altKey ? 'zoom' : 'pan') : 'edit',
    x: e.clientX,
    y: e.clientY,
    moved: false,
    startX: p.x,
    startY: p.y,
    button: e.button,
  };
  if (!wantPan && !e.button) {
    s.beginStroke();
    handleEditDown(p);
  }
}

function handleEditDown(p) {
  const s = session.value;
  const voxel = pickAtScreen(p.x, p.y);
  if (s.tool.value === 'select') {
    s.beginSelection(voxel);
  } else if (s.tool.value === 'pick') {
    if (voxel) s.pickAt(voxel);
  } else {
    if (voxel) {
      lastPaintVoxel = voxel;
      if (s.tool.value === 'erase') s.eraseAt(voxel);
      else s.placeOnFace(voxel);
      computeLayerDensity();
    }
  }
}

let lastPaintVoxel = null;

function pickAtScreen(px, py) {
  const s = session.value;
  let voxel = s.renderer.pickVoxel(px, py);
  if (!voxel) {
    // 空白处：落到当前编辑层平面上，便于“空中起建”
    voxel = s.renderer.pickLayerPlane(px, py, s.activeLayer.value - 1);
  }
  return voxel;
}

function onPointerMove(e) {
  const s = session.value;
  if (!s) return;
  const p = canvasPoint(e);
  if (dragging) {
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragging.moved = true;
    if (dragging.mode === 'pan') {
      s.renderer.pan(dx, dy);
    } else if (dragging.mode === 'zoom') {
      s.renderer.zoom(dy * 6);
    } else if (dragging.mode === 'edit') {
      dragging.x = e.clientX;
      dragging.y = e.clientY;
      if (s.tool.value === 'select') {
        const v = pickAtScreen(p.x, p.y);
        if (v) s.extendSelection(v);
      } else if (s.tool.value === 'build' || s.tool.value === 'erase') {
        const v = pickAtScreen(p.x, p.y);
        if (v && (!lastPaintVoxel || v.x !== lastPaintVoxel.x || v.y !== lastPaintVoxel.y || v.z !== lastPaintVoxel.z)) {
          lastPaintVoxel = v;
          if (s.tool.value === 'erase') s.eraseAt(v);
          else s.placeOnFace(v);
          computeLayerDensity();
        }
      }
    }
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    s.requestRender();
    return;
  }

  // 悬停拾取
  const voxel = s.renderer.pickVoxel(p.x, p.y);
  if (voxel) {
    s.renderer.hover = voxel;
    s.cursor.x = voxel.x;
    s.cursor.y = voxel.y;
    s.cursor.z = voxel.z + 1;
    s.cursor.mat = voxel.mat;
    s.cursor.valid = true;
  } else {
    const plane = s.renderer.pickLayerPlane(p.x, p.y, s.activeLayer.value - 1);
    s.renderer.hover = null;
    if (plane) {
      s.cursor.x = plane.x;
      s.cursor.y = plane.y;
      s.cursor.z = s.activeLayer.value;
      s.cursor.mat = 0;
      s.cursor.valid = true;
    } else {
      s.cursor.valid = false;
      s.cursor.mat = 0;
    }
  }
  s.requestRender();
}

function onPointerUp(e) {
  const s = session.value;
  if (!s) return;
  if (dragging?.mode === 'edit' && s.tool.value === 'select') {
    s.updateSelectionCount();
  }
  try {
    canvasEl.value.releasePointerCapture(e.pointerId);
  } catch {
    /* 指针已释放 */
  }
  dragging = null;
  lastPaintVoxel = null;
  s.endStroke();
  computeLayerDensity();
}

function onPointerLeave() {
  const s = session.value;
  if (s) {
    s.renderer.hover = null;
    s.cursor.valid = false;
    s.cursor.mat = 0;
    s.requestRender();
  }
}

function onWheel(e) {
  const s = session.value;
  if (!s) return;
  s.renderer.zoom(e.deltaY);
  s.requestRender();
}

// ---------------------------------------------------------------- 操作

function setTool(key) {
  if (!session.value) return;
  session.value.tool.value = key;
  if (key === 'erase') eraseMode.value = true;
  if (key === 'build') eraseMode.value = false;
  session.value.requestRender();
}

function pickMat(id) {
  session.value.brushMat.value = id;
  if (session.value.tool.value === 'erase') session.value.tool.value = 'build';
}

function stepLayer(delta) {
  if (!session.value) return;
  session.value.setActiveLayer(session.value.activeLayer.value + delta);
}

function onLayerClick(lv, ev) {
  if (ev.shiftKey) {
    // Shift 点击：扩展层范围到该层
    session.value.setLayerRange(Math.min(session.value.layerMin.value, lv), Math.max(session.value.layerMax.value, lv));
  } else if (ev.altKey) {
    session.value.toggleSolo(lv);
    visibleLayersText.value = [...session.value.soloLayers.value].sort((a, b) => a - b).join(', ');
  } else {
    session.value.setActiveLayer(lv);
  }
}

function setRange(a, b) {
  session.value.setLayerRange(Number(a), Number(b));
}

function toggleMirror() {
  session.value.setMirror(!session.value.mirror.enabled);
  toast(session.value.mirror.enabled ? '镜像已开启' : '镜像已关闭', 'ok', 1600);
}

function setMirrorPlane(v) {
  session.value.setMirrorPlane(Number(v));
}

function toggleFocus() {
  session.value.toggleFocus();
}

function setView(mode) {
  viewMode.value = mode;
  const r = session.value.renderer;
  if (mode === 'iso') r.setIsoView();
  else if (mode === 'top') r.setTopView();
  else r.setSideView();
  session.value.requestRender();
}

function cycleShading() {
  const order = ['material', 'layers', 'normals'];
  const i = order.indexOf(shading.value);
  shading.value = order[(i + 1) % 3];
  session.value.renderer.opts.shading = shading.value;
  session.value.requestRender();
}

function frameAll() {
  session.value.renderer.frameAll();
  session.value.requestRender();
}

function focusBox(box) {
  session.value.focusIssue({ bbox: box });
}

function copySel() {
  if (session.value.copySelection()) {
    toast(`已复制 ${session.value.clipboard.value.count.toLocaleString('zh-CN')} 格`, 'ok', 1600);
  }
}
function cutSel() {
  if (session.value.clipboard.value) {
    const n = session.value.deleteSelection();
    toast(`已剪切 ${n.toLocaleString('zh-CN')} 格`, 'ok', 1600);
    computeLayerDensity();
  }
}
function delSel() {
  const n = session.value.deleteSelection();
  toast(`已删除 ${n.toLocaleString('zh-CN')} 格`, 'ok', 1600);
  computeLayerDensity();
}
function clearSel() {
  session.value.clearSelection();
}
function fillSel() {
  const n = session.value.fillSelection(session.value.brushMat.value);
  toast(`填充 ${n.toLocaleString('zh-CN')} 格`, 'ok', 1600);
  computeLayerDensity();
}
function fillAir() {
  const n = session.value.fillSelectionAir(session.value.brushMat.value);
  toast(`灌入 ${n.toLocaleString('zh-CN')} 格`, 'ok', 1600);
  computeLayerDensity();
}
function pasteAtSel() {
  const b = session.value.normalizeSelection();
  if (!b) return;
  applyPaste({ x: b.x0, y: b.y0, z: b.z0 });
}
function pasteAtCursor() {
  if (!session.value.clipboard.value) return;
  const b = session.value.normalizeSelection();
  if (b) {
    applyPaste({ x: b.x0, y: b.y0, z: b.z0 });
  } else {
    const c = session.value.cursor;
    if (!c.valid) {
      toast('先把指针移到视图里，或先框选一个落点', 'warn');
      return;
    }
    applyPaste({ x: c.x, y: c.y, z: c.z - 1 });
  }
}
function applyPaste(anchor) {
  const n = session.value.paste(anchor);
  if (n) toast(`粘贴 ${n.toLocaleString('zh-CN')} 格`, 'ok', 1600);
  else toast('粘贴位置没有写入任何体素（可能被层锁挡住或已在网格外）', 'warn');
  computeLayerDensity();
}

function doReplace() {
  const from = replaceFrom.value;
  const to = session.value.brushMat.value;
  let n = 0;
  if (from === 'any') {
    n = session.value.replaceMaterial('any', to);
  } else if (String(from).startsWith('group:')) {
    const g = String(from).slice(6);
    n = session.value.replaceGroup(g, currentMat.value.group, appState.materials, appState.groups);
  } else {
    n = session.value.replaceMaterial(Number(from), to);
  }
  if (n) toast(`替换 ${n.toLocaleString('zh-CN')} 格`, 'ok');
  else toast('没有匹配的体素可替换', 'warn');
  computeLayerDensity();
}

function doArray(cfg) {
  const res = session.value.arrayCopy(cfg);
  arrayOpen.value = false;
  if (res.error) {
    toast(res.error, 'warn');
  } else if (res.added) {
    toast(`阵列复制 ${res.count} 份，新增 ${res.added.toLocaleString('zh-CN')} 格`, 'ok');
  }
  computeLayerDensity();
}

function runCheck(silent = false) {
  const s = session.value;
  if (!s) return;
  s.params.floatingMin = params.floatingMin;
  s.params.minWall = params.minWall;
  const a = s.runCheck();
  computeLayerDensity();
  if (a && !silent) {
    if (a.ok) toast('体检通过：未发现阻塞合并的问题', 'ok');
    else toast(`体检发现 ${a.issues.filter((i) => i.severity === 'error').length} 类阻塞问题`, 'warn', 4000);
  }
}

function rerunIfChecked() {
  if (session.value.analysis.value) runCheck(true);
}

// ---------------------------------------------------------------- 保存/提交/导出

function serialize() {
  return session.value.model.value.toJSON();
}

async function save(silent = false) {
  if (!session.value || saving.value) return false;
  saving.value = true;
  try {
    await apiClient.saveModel(orderId.value, { data: serialize() });
    dirty.value = false;
    lastSaved.value = new Date().toISOString();
    if (!silent) toast('模型已保存', 'ok', 1800);
    return true;
  } catch (err) {
    toast(err.message, 'err', 4200);
    return false;
  } finally {
    saving.value = false;
  }
}

async function submitQc() {
  const a = session.value.runCheck();
  if (!a.ok) {
    toast('还有悬空体素簇，先在右侧体检面板定位并处理', 'warn', 4600);
    return;
  }
  const ok = await save(true);
  if (!ok) return;
  try {
    await apiClient.setStatus(orderId.value, { status: 'submitted' });
    order.value = await apiClient.order(orderId.value);
    toast('已提交质检', 'ok');
  } catch (err) {
    toast(err.message, 'err', 4200);
  }
}

function onExported() {
  toast('导出包已下载', 'ok');
  if (canEdit.value) save(true);
}

function goBack() {
  router.push('/orders');
}

// ---------------------------------------------------------------- 键盘

function onKeyDown(e) {
  const s = session.value;
  if (!s) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const key = e.key.toLowerCase();
  const meta = e.ctrlKey || e.metaKey;

  if (meta && key === 's') {
    e.preventDefault();
    save();
    return;
  }
  if (meta && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) s.redo();
    else s.undo();
    computeLayerDensity();
    return;
  }
  if (meta && key === 'c') {
    e.preventDefault();
    copySel();
    return;
  }
  if (meta && key === 'x') {
    e.preventDefault();
    cutSel();
    return;
  }
  if (meta && key === 'v') {
    e.preventDefault();
    pasteAtCursor();
    return;
  }
  if (meta) return;

  switch (key) {
    case 'b': setTool('build'); break;
    case 'e': setTool('erase'); break;
    case 's': setTool('select'); break;
    case 'i': setTool('pick'); break;
    case 'm': toggleMirror(); break;
    case 'f': frameAll(); break;
    case 'l': s.toggleLock(); break;
    case '[': stepLayer(-1); break;
    case ']': stepLayer(1); break;
    case 'escape': s.clearSelection(); break;
    case 'delete':
    case 'backspace':
      if (s.selection.active) {
        e.preventDefault();
        delSel();
      }
      break;
    default:
  }
}

// ---------------------------------------------------------------- 生命周期

let resizeTimer = null;

onMounted(async () => {
  await boot();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('beforeunload', onBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('beforeunload', onBeforeUnload);
  session.value?.renderer?.dispose();
});

function onBeforeUnload(e) {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}

// 模型每次成功写入后标记 dirty
watch(
  () => session.value?.undoDepth.value,
  () => {
    dirty.value = true;
    computeLayerDensity();
  }
);
</script>

<style scoped>
.editor-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-0);
}

.ed-head {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line-1);
  background: var(--bg-1);
}
.ed-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.3;
}
.head-div {
  width: 1px;
  height: 20px;
  background: var(--line-2);
  margin: 0 3px;
}
.mini-badge {
  font-family: var(--font-mono);
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  margin-left: 2px;
}
.mini-badge.ok { background: var(--green-soft); color: var(--green); }
.mini-badge.bad { background: var(--red-soft); color: var(--red); }

.ed-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* ------------------------------------------------------------ 左侧 */

.ed-left {
  width: 212px;
  flex-shrink: 0;
  border-right: 1px solid var(--line-1);
  background: var(--bg-1);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.tools {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-bottom: 1px solid var(--line-1);
}
.tool-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 32px;
  padding: 0 9px;
  border-radius: var(--r-1);
  font-size: 12px;
  color: var(--fg-2);
  transition: 0.12s;
  text-align: left;
}
.tool-btn:hover { background: var(--bg-3); color: var(--fg-0); }
.tool-btn.on {
  background: rgba(226, 160, 77, 0.12);
  color: var(--lunar);
  box-shadow: inset 2px 0 0 var(--lunar);
}
.tool-kbd { margin-left: auto; opacity: 0.5; }
.tool-btn.on .tool-kbd { opacity: 0.8; }

.presets {
  padding: 0 10px 10px;
  border-bottom: 1px solid var(--line-1);
}
.preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
}
.preset-row:last-child { margin-bottom: 0; }
.layer-num {
  flex: 1;
  text-align: center;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--fg-0);
}

.mat-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 10px;
}
.mat-swatch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px;
  border-radius: var(--r-1);
  background: var(--bg-2);
  border: 1px solid var(--line-1);
}
.swatch-big {
  width: 22px;
  height: 22px;
  border-radius: 3px;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.mat-scroll {
  flex: 1;
  min-height: 0;
  padding-bottom: 10px;
}
.mat-group-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--fg-3);
  padding: 7px 0 4px;
  text-transform: uppercase;
}
.mg-dot {
  width: 5px;
  height: 5px;
  border-radius: 1px;
}
.mat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.mat-tile {
  position: relative;
  aspect-ratio: 1;
  border-radius: 3px;
  border: 1px solid var(--line-1);
  overflow: hidden;
  transition: 0.1s;
}
.mat-tile:hover { border-color: var(--line-3); transform: scale(1.04); }
.mat-tile.on {
  box-shadow: 0 0 0 1.5px var(--lunar);
  border-color: transparent;
}
.mat-chip {
  position: absolute;
  inset: 0;
  background: var(--mc);
  opacity: 0.85;
}
.mat-num {
  position: absolute;
  left: 2px;
  bottom: 1px;
  font-size: 8px;
  color: rgba(0, 0, 0, 0.62);
  font-weight: 700;
}
.mat-emis {
  position: absolute;
  right: 3px;
  top: 3px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 5px #fff;
}

/* ------------------------------------------------------------ 视口 */

.viewport-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.viewport {
  flex: 1;
  min-height: 220px;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(120% 80% at 50% 0%, #131720 0%, #0a0c11 46%, #070809 100%);
}
.gl-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: crosshair;
  touch-action: none;
}
.tool-erase .gl-canvas { cursor: cell; }
.tool-select .gl-canvas { cursor: crosshair; }
.tool-pan .gl-canvas { cursor: grab; }

.hud {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  z-index: 4;
}
.hud-tl { top: 12px; left: 12px; }
.hud-tr { top: 12px; right: 12px; pointer-events: auto; }
.hud-bl { bottom: 12px; left: 12px; }
.hud-br { bottom: 12px; right: 12px; }

.hud-box {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 9px;
  background: rgba(10, 12, 16, 0.72);
  backdrop-filter: blur(6px);
  border: 1px solid var(--line-1);
  border-radius: var(--r-1);
}
.hud-k {
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-4);
}
.hud-v { font-size: 11px; color: var(--fg-1); }

.view-seg {
  background: rgba(10, 12, 16, 0.72);
  backdrop-filter: blur(6px);
}

.coord {
  padding: 4px 9px;
  background: rgba(10, 12, 16, 0.72);
  backdrop-filter: blur(6px);
  border: 1px solid var(--line-1);
  border-radius: var(--r-1);
  font-size: 10.5px;
  color: var(--fg-3);
}
.coord b { color: var(--fg-1); font-weight: 600; }
.hud-sep { width: 1px; height: 14px; background: var(--line-2); }

.mirror-flag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: var(--r-1);
  background: rgba(79, 195, 173, 0.14);
  border: 1px solid rgba(79, 195, 173, 0.26);
  color: #8fe7d5;
  font-size: 10px;
  font-weight: 600;
  backdrop-filter: blur(6px);
}

.sel-toolbar {
  position: absolute;
  bottom: 46px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 7px;
  background: rgba(17, 20, 26, 0.94);
  backdrop-filter: blur(8px);
  border: 1px solid var(--line-3);
  border-radius: var(--r-2);
  box-shadow: var(--shadow-2);
  z-index: 6;
}
.st-btn {
  width: 26px;
  height: 26px;
  border-radius: 3px;
  display: grid;
  place-items: center;
  color: var(--fg-2);
  transition: 0.1s;
}
.st-btn:hover { background: var(--bg-4); color: var(--fg-0); }
.st-btn.danger:hover { background: var(--red-soft); color: var(--red); }
.st-div { width: 1px; height: 16px; background: var(--line-2); margin: 0 2px; }

.toolpop-enter-active { transition: opacity 0.16s, transform 0.16s; }
.toolpop-enter-from { opacity: 0; transform: translateX(-50%) translateY(6px); }

.vp-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(7, 8, 9, 0.88);
  color: var(--fg-2);
  z-index: 10;
}
.vp-error { color: var(--red); }

/* ------------------------------------------------------------ 层条 */

.layerbar {
  flex-shrink: 0;
  border-top: 1px solid var(--line-1);
  background: var(--bg-1);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: auto 1fr;
  grid-template-areas:
    'head body range'
    'hover hover hover';
  align-items: center;
  column-gap: 12px;
  row-gap: 4px;
  padding: 8px 12px;
  min-height: 88px;
}
.lb-head {
  grid-area: head;
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  height: 20px;
  color: var(--fg-3);
}
.lb-body {
  grid-area: body;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
  row-gap: 6px;
}
.lb-focus {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 46px;
  height: 54px;
  justify-content: center;
  border-radius: var(--r-1);
  border: 1px solid var(--line-1);
  color: var(--fg-3);
  transition: 0.12s;
  flex-shrink: 0;
}
.lb-focus:hover { background: var(--bg-3); color: var(--fg-0); }
.lb-focus.on {
  background: var(--cyan-soft);
  border-color: rgba(95, 168, 216, 0.32);
  color: #8cc6ea;
}

.lb-strip {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 0;
  height: 54px;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 2px 0;
  scrollbar-width: thin;
}
.lb-cell {
  position: relative;
  flex: 1 1 0;
  min-width: 4px;
  max-width: 26px;
  margin: 0 0.5px;
  border-radius: 1px;
  background: var(--bg-2);
  overflow: hidden;
  transition: 0.1s;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.lb-cell:hover { outline: 1px solid var(--line-3); }
.lb-cell .lb-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: calc(var(--d) * 100%);
  background: rgba(226, 160, 77, 0.22);
}
.lb-cell.inRange .lb-fill { background: rgba(226, 160, 77, 0.34); }
.lb-cell.soloed .lb-fill { background: rgba(95, 168, 216, 0.45); }
.lb-cell.locked::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(45deg, rgba(255,255,255,0.045) 0 2px, transparent 2px 5px);
}
.lb-cell.active {
  outline: 1.5px solid var(--lunar);
  outline-offset: -1px;
  background: var(--bg-4);
  z-index: 2;
}
.lb-cell .lb-num {
  position: relative;
  font-family: var(--font-mono);
  font-size: 7px;
  color: var(--fg-4);
  padding-bottom: 1px;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}
.lb-cell.major .lb-num { color: var(--fg-3); }
.lb-cell.active .lb-num { color: var(--lunar); }
.lb-cell.hovered .lb-num { color: var(--fg-1); }
.lb-lock {
  position: absolute;
  top: 2px;
  right: 1px;
  color: var(--amber);
}

.lb-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  flex-wrap: wrap;
  margin-left: auto;
}
.lb-visible {
  display: flex;
  align-items: center;
  gap: 5px;
}
.lb-vis-input {
  width: 86px;
  height: 24px;
  padding: 0 6px;
  font-size: 11px;
}
.hover-mat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: var(--r-1);
  background: rgba(10, 12, 16, 0.72);
  border: 1px solid var(--line-1);
  backdrop-filter: blur(6px);
  font-size: 10.5px;
  color: var(--fg-1);
}
.hover-mat i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}
.lb-hover {
  grid-area: hover;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  color: var(--fg-2);
  padding-left: 2px;
  white-space: nowrap;
  overflow: hidden;
}
.lb-range {
  grid-area: range;
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: center;
  white-space: nowrap;
}
@media (max-width: 1080px) {
  .lb-range { grid-area: hover; justify-self: end; }
  .lb-hover { grid-area: hover; justify-self: start; }
  .lb-hover + .lb-range { grid-column: 1 / -1; }
}
.lb-num {
  width: 46px;
  height: 24px;
  padding: 0 4px;
  text-align: center;
  font-size: 11px;
}

/* ------------------------------------------------------------ 右侧 */

.ed-right {
  width: 314px;
  flex-shrink: 0;
  border-left: 1px solid var(--line-1);
  background: var(--bg-1);
  min-height: 0;
  padding-bottom: 24px;
}

.rpanel {
  border-bottom: 1px solid var(--line-1);
}
.rpanel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
  min-height: 40px;
}
.rpanel-title {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--fg-2);
}
.rpanel-body {
  padding: 0 14px 14px;
}

.hint {
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-3);
}

.mirror-ctrl { margin-top: 10px; }
.mirror-ctrl.disabled { opacity: 0.45; }

.sel-info {
  padding: 8px 10px;
  background: var(--bg-2);
  border: 1px solid var(--line-1);
  border-radius: var(--r-1);
  margin-bottom: 9px;
}
.sel-bbox { font-size: 10.5px; color: var(--fg-1); }
.sel-dim { font-size: 10px; color: var(--fg-3); margin-top: 2px; }

.act-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}
.act {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 4px 6px;
  border-radius: var(--r-1);
  border: 1px solid var(--line-1);
  background: var(--bg-2);
  font-size: 10px;
  color: var(--fg-2);
  transition: 0.12s;
}
.act:hover:not(:disabled) { background: var(--bg-4); color: var(--fg-0); border-color: var(--line-3); }
.act:disabled { opacity: 0.35; cursor: not-allowed; }

.clip-info {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding: 5px 8px;
  border-radius: var(--r-1);
  background: var(--teal-soft);
  color: #8fe7d5;
  font-size: 10.5px;
}

.fill-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
}

.check-params {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.cp-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 9px;
  background: var(--bg-2);
  border: 1px solid var(--line-1);
  border-radius: var(--r-1);
}
.cp-num {
  width: 42px;
  height: 22px;
  padding: 0 4px;
  text-align: center;
  font-size: 11px;
}

.stale-flag {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 9px;
  font-size: 10.5px;
  color: var(--amber);
}

.verdict {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 11px;
  border-radius: var(--r-1);
  margin-top: 10px;
}
.verdict.ok { background: var(--teal-soft); color: #8fe7d5; border: 1px solid rgba(79, 195, 173, 0.24); }
.verdict.bad { background: var(--red-soft); color: #f19aa0; border: 1px solid rgba(229, 98, 106, 0.28); }

.issue-cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 9px;
}
.issue-card {
  padding: 8px 10px;
  border-radius: var(--r-1);
  background: var(--bg-2);
  border-left: 2px solid var(--amber);
}
.issue-card.error { border-left-color: var(--red); }
.issue-card.info { border-left-color: var(--fg-4); }
.issue-mark {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--amber);
}
.issue-mark.error { background: var(--red); }
.issue-mark.info { background: var(--fg-4); }
.issue-desc { font-size: 10.5px; line-height: 1.5; color: var(--fg-3); margin-top: 3px; }

.locate-list { margin-top: 11px; }
.locate-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 7px;
  border-radius: var(--r-1);
  background: var(--bg-2);
  margin-bottom: 3px;
  transition: 0.1s;
}
.locate-item:hover { background: var(--bg-4); }
.loc-dot { width: 4px; height: 4px; border-radius: 50%; flex-shrink: 0; }
.loc-dot.error { background: var(--red); }
.loc-dot.warn { background: var(--amber); }

.req-mini {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
  padding: 3px 0;
  align-items: baseline;
}
.req-mini-k { color: var(--fg-3); min-width: 62px; flex-shrink: 0; }
.req-mini-v { color: var(--fg-1); font-family: var(--font-mono); font-size: 11px; }
.brief-mini {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--bg-2);
  border-left: 2px solid rgba(226, 160, 77, 0.3);
  border-radius: 0 var(--r-1) var(--r-1) 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--fg-3);
}

.keys {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.keys > div {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--fg-3);
}
.keys > div span:last-child { margin-left: 5px; }

.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1280px) {
  .ed-left { width: 186px; }
  .ed-right { width: 280px; }
}

@media (max-width: 1080px) {
  .ed-left { width: 164px; }
  .ed-right { width: 252px; }
  .ed-head { height: auto; padding: 8px 12px; flex-wrap: wrap; row-gap: 6px; }
  .lb-head .track-wide { display: none; }
}

@media (max-width: 900px) {
  .ed-left { width: 148px; }
  .ed-right { width: 224px; }
  .mat-grid { grid-template-columns: repeat(3, 1fr); }
  .mat-scroll { max-height: 180px; }
  .hud-tl .hud-box:nth-child(3) { display: none; }
  .lb-strip { height: 40px; }
  .lb-focus { height: 40px; width: 38px; }
}
</style>
