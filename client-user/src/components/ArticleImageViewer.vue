<template>
  <div
    class="article-image-viewer"
    role="dialog"
    aria-modal="true"
    aria-label="图片预览"
    @click.self="closeViewer"
  >
    <button
      type="button"
      class="article-image-viewer__close"
      aria-label="关闭图片预览"
      @click="closeViewer"
    >
      ×
    </button>
    <div
      class="article-image-viewer__canvas"
      @click.self="handleCanvasClick"
      @wheel.prevent="handleWheel"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerEnd"
      @pointercancel="handlePointerEnd"
    >
      <img
        v-if="!loadFailed"
        ref="imageRef"
        class="article-image-viewer__image"
        :class="{ 'is-draggable': scale > 1 }"
        :src="src"
        :alt="alt"
        :style="imageTransformStyle"
        draggable="false"
        @load="handleImageLoad"
        @error="loadFailed = true"
      />
      <p v-else class="article-image-viewer__error">图片加载失败</p>
    </div>

    <div class="article-image-viewer__toolbar" @click.stop>
      <button
        type="button"
        class="article-image-viewer__zoom-out"
        aria-label="缩小图片"
        @click="zoomOut"
      >−</button>
      <span class="article-image-viewer__scale">{{ scalePercent }}%</span>
      <button
        type="button"
        class="article-image-viewer__zoom-in"
        aria-label="放大图片"
        @click="zoomIn"
      >＋</button>
      <button
        type="button"
        class="article-image-viewer__reset"
        @click="resetTransform"
      >复原</button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits(['close'])

defineProps({
  src: {
    type: String,
    required: true
  },
  alt: {
    type: String,
    default: ''
  }
})

let previousBodyOverflow = ''
const imageRef = ref(null)
const scale = ref(1)
const maxScale = ref(4)
const offsetX = ref(0)
const offsetY = ref(0)
const loadFailed = ref(false)
const activePointers = new Map()
let dragOrigin = null
let pinchStartDistance = 0
let pinchStartScale = 1
let pointerStartedOnImage = false
let ignoreNextCanvasClick = false
let ignoreCanvasClickTimer = null

const scalePercent = computed(() => Math.round(scale.value * 100))
const imageTransformStyle = computed(() => ({
  transform: `translate3d(${offsetX.value}px, ${offsetY.value}px, 0) scale(${scale.value})`
}))

/** 请求父页面关闭当前预览。 */
function closeViewer() {
  emit('close')
}

/** 桌面端允许使用 Escape 快速退出图片预览。 */
function handleKeydown(event) {
  if (event.key === 'Escape') closeViewer()
}

/** 将缩放比例限制在初始适配状态与原图细节所需的最大比例之间。 */
function clampScale(value) {
  return Math.min(maxScale.value, Math.max(1, value))
}

/** 限制拖动范围，防止放大后的图片完全离开可视区域。 */
function clampOffsets() {
  const image = imageRef.value
  const canvas = image?.parentElement
  if (!image || !canvas || scale.value <= 1) {
    offsetX.value = 0
    offsetY.value = 0
    return
  }

  const maxX = Math.max(0, (image.clientWidth * scale.value - canvas.clientWidth) / 2)
  const maxY = Math.max(0, (image.clientHeight * scale.value - canvas.clientHeight) / 2)
  offsetX.value = Math.min(maxX, Math.max(-maxX, offsetX.value))
  offsetY.value = Math.min(maxY, Math.max(-maxY, offsetY.value))
}

/** 应用新的缩放比例；回到适配比例时同时复位位移。 */
function setScale(value) {
  scale.value = Number(clampScale(value).toFixed(3))
  nextTick(clampOffsets)
}

function zoomIn() {
  setScale(scale.value * 1.2)
}

function zoomOut() {
  setScale(scale.value / 1.2)
}

/** 恢复到占视口至多 80% 的初始完整适配状态。 */
function resetTransform() {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
}

/** 图片载入后根据自然尺寸保证最大倍率能够覆盖原始像素细节。 */
function handleImageLoad() {
  const image = imageRef.value
  if (!image?.clientWidth || !image?.clientHeight) return

  const naturalScale = Math.max(
    image.naturalWidth / image.clientWidth,
    image.naturalHeight / image.clientHeight
  )
  maxScale.value = Math.max(4, naturalScale)
}

/** 桌面端滚轮向上放大、向下缩小。 */
function handleWheel(event) {
  if (event.deltaY < 0) zoomIn()
  else if (event.deltaY > 0) zoomOut()
}

/** 忽略由图片指针捕获重新定向到画布的合成点击，其余空白点击正常关闭。 */
function handleCanvasClick() {
  if (ignoreNextCanvasClick) {
    ignoreNextCanvasClick = false
    return
  }
  closeViewer()
}

function pointerDistance() {
  const [first, second] = Array.from(activePointers.values())
  if (!first || !second) return 0
  return Math.hypot(second.x - first.x, second.y - first.y)
}

/** 记录鼠标或触摸点；两个触点进入双指缩放，一个触点进入拖动。 */
function handlePointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (activePointers.size === 0) {
    pointerStartedOnImage = event.target === imageRef.value
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

  if (activePointers.size === 2) {
    pinchStartDistance = pointerDistance()
    pinchStartScale = scale.value
    dragOrigin = null
  } else if (activePointers.size === 1) {
    dragOrigin = {
      x: event.clientX,
      y: event.clientY,
      offsetX: offsetX.value,
      offsetY: offsetY.value
    }
  }
}

/** 根据双指间距缩放；单指或鼠标在图片放大后拖动查看细节。 */
function handlePointerMove(event) {
  if (!activePointers.has(event.pointerId)) return
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

  if (activePointers.size >= 2 && pinchStartDistance > 0) {
    setScale(pinchStartScale * (pointerDistance() / pinchStartDistance))
    return
  }

  if (scale.value > 1 && dragOrigin) {
    offsetX.value = dragOrigin.offsetX + event.clientX - dragOrigin.x
    offsetY.value = dragOrigin.offsetY + event.clientY - dragOrigin.y
    clampOffsets()
  }
}

/** 清理离开的触点，并让剩余单指可以继续拖动。 */
function handlePointerEnd(event) {
  activePointers.delete(event.pointerId)
  const remaining = Array.from(activePointers.values())[0]
  dragOrigin = remaining
    ? { x: remaining.x, y: remaining.y, offsetX: offsetX.value, offsetY: offsetY.value }
    : null
  pinchStartDistance = 0
  pinchStartScale = scale.value

  if (activePointers.size === 0 && pointerStartedOnImage) {
    ignoreNextCanvasClick = true
    clearTimeout(ignoreCanvasClickTimer)
    ignoreCanvasClickTimer = setTimeout(() => {
      ignoreNextCanvasClick = false
    }, 0)
  }
  if (activePointers.size === 0) pointerStartedOnImage = false
}

/** 锁定底层文章滚动，并记住进入预览前的页面状态。 */
onMounted(() => {
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  window.addEventListener('keydown', handleKeydown)
})

/** 离开预览时恢复页面原有滚动设置。 */
onBeforeUnmount(() => {
  document.body.style.overflow = previousBodyOverflow
  window.removeEventListener('keydown', handleKeydown)
  clearTimeout(ignoreCanvasClickTimer)
  activePointers.clear()
})
</script>

<style scoped>
.article-image-viewer {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.88);
}

.article-image-viewer__canvas {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
}

.article-image-viewer__image {
  display: block;
  max-width: 80vw;
  max-height: 80vh;
  max-height: 80dvh;
  width: auto;
  height: auto;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
  transform-origin: center center;
  cursor: default;
  will-change: transform;
}

.article-image-viewer__image.is-draggable {
  cursor: grab;
}

.article-image-viewer__close {
  position: fixed;
  top: max(18px, env(safe-area-inset-top));
  right: max(18px, env(safe-area-inset-right));
  z-index: 1;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 32px;
  line-height: 42px;
  cursor: pointer;
}

.article-image-viewer__toolbar {
  position: fixed;
  left: 50%;
  bottom: max(20px, env(safe-area-inset-bottom));
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
  padding: 8px;
  border-radius: 12px;
  background: rgba(20, 20, 20, 0.78);
  color: #fff;
}

.article-image-viewer__toolbar button {
  min-width: 42px;
  min-height: 42px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}

.article-image-viewer__zoom-in,
.article-image-viewer__zoom-out {
  font-size: 24px !important;
}

.article-image-viewer__scale {
  min-width: 52px;
  text-align: center;
  font-size: 14px;
}

.article-image-viewer__error {
  color: #fff;
  font-size: 15px;
}

@media (max-width: 768px) {
  .article-image-viewer__close {
    width: 48px;
    height: 48px;
  }

  .article-image-viewer__toolbar {
    width: max-content;
    max-width: calc(100vw - 24px);
  }

  .article-image-viewer__toolbar button {
    min-width: 44px;
    min-height: 44px;
  }
}
</style>
