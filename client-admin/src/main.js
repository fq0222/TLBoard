/**
 * 管理端前端主入口文件。
 * 只注册项目中实际使用的 Element Plus 组件和图标，避免把完整组件库打进首屏包。
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ElAlert } from 'element-plus/es/components/alert/index.mjs'
import { ElBreadcrumb, ElBreadcrumbItem } from 'element-plus/es/components/breadcrumb/index.mjs'
import { ElButton } from 'element-plus/es/components/button/index.mjs'
import { ElCard } from 'element-plus/es/components/card/index.mjs'
import { ElCheckbox } from 'element-plus/es/components/checkbox/index.mjs'
import { ElDatePicker } from 'element-plus/es/components/date-picker/index.mjs'
import { ElDescriptions, ElDescriptionsItem } from 'element-plus/es/components/descriptions/index.mjs'
import { ElDialog } from 'element-plus/es/components/dialog/index.mjs'
import { ElDivider } from 'element-plus/es/components/divider/index.mjs'
import { ElDrawer } from 'element-plus/es/components/drawer/index.mjs'
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus/es/components/dropdown/index.mjs'
import { ElEmpty } from 'element-plus/es/components/empty/index.mjs'
import { ElForm, ElFormItem } from 'element-plus/es/components/form/index.mjs'
import { ElIcon } from 'element-plus/es/components/icon/index.mjs'
import { ElInput } from 'element-plus/es/components/input/index.mjs'
import { ElInputNumber } from 'element-plus/es/components/input-number/index.mjs'
import { ElLoading } from 'element-plus/es/components/loading/index.mjs'
import { ElPagination } from 'element-plus/es/components/pagination/index.mjs'
import { ElRadio, ElRadioButton, ElRadioGroup } from 'element-plus/es/components/radio/index.mjs'
import { ElOption, ElSelect } from 'element-plus/es/components/select/index.mjs'
import { ElSwitch } from 'element-plus/es/components/switch/index.mjs'
import { ElTable, ElTableColumn } from 'element-plus/es/components/table/index.mjs'
import { ElTabPane, ElTabs } from 'element-plus/es/components/tabs/index.mjs'
import { ElTag } from 'element-plus/es/components/tag/index.mjs'
import { ElUpload } from 'element-plus/es/components/upload/index.mjs'
import {
  ArrowDown,
  Bell,
  ChatDotRound,
  Connection,
  CopyDocument,
  DataAnalysis,
  DataBoard,
  Delete,
  Document,
  Edit,
  Expand,
  Fold,
  Folder,
  Goods,
  InfoFilled,
  Link,
  Loading,
  Lock,
  Message,
  Monitor,
  Odometer,
  Plus,
  Position,
  Promotion,
  Reading,
  Refresh,
  Search,
  Setting,
  Share,
  Switch,
  SwitchButton,
  Tickets,
  Upload,
  User,
  View
} from '@element-plus/icons-vue'
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/el-overlay.css'
import 'element-plus/theme-chalk/el-popper.css'
import 'element-plus/theme-chalk/el-scrollbar.css'
import 'element-plus/theme-chalk/el-tooltip.css'
import 'element-plus/theme-chalk/el-alert.css'
import 'element-plus/theme-chalk/el-breadcrumb.css'
import 'element-plus/theme-chalk/el-breadcrumb-item.css'
import 'element-plus/theme-chalk/el-button.css'
import 'element-plus/theme-chalk/el-card.css'
import 'element-plus/theme-chalk/el-checkbox.css'
import 'element-plus/theme-chalk/el-date-picker.css'
import 'element-plus/theme-chalk/el-date-picker-panel.css'
import 'element-plus/theme-chalk/el-time-picker.css'
import 'element-plus/theme-chalk/el-descriptions.css'
import 'element-plus/theme-chalk/el-descriptions-item.css'
import 'element-plus/theme-chalk/el-dialog.css'
import 'element-plus/theme-chalk/el-divider.css'
import 'element-plus/theme-chalk/el-drawer.css'
import 'element-plus/theme-chalk/el-dropdown.css'
import 'element-plus/theme-chalk/el-dropdown-item.css'
import 'element-plus/theme-chalk/el-dropdown-menu.css'
import 'element-plus/theme-chalk/el-empty.css'
import 'element-plus/theme-chalk/el-form.css'
import 'element-plus/theme-chalk/el-form-item.css'
import 'element-plus/theme-chalk/el-icon.css'
import 'element-plus/theme-chalk/el-input.css'
import 'element-plus/theme-chalk/el-input-number.css'
import 'element-plus/theme-chalk/el-loading.css'
import 'element-plus/theme-chalk/el-message.css'
import 'element-plus/theme-chalk/el-message-box.css'
import 'element-plus/theme-chalk/el-option.css'
import 'element-plus/theme-chalk/el-pagination.css'
import 'element-plus/theme-chalk/el-radio.css'
import 'element-plus/theme-chalk/el-radio-button.css'
import 'element-plus/theme-chalk/el-radio-group.css'
import 'element-plus/theme-chalk/el-select.css'
import 'element-plus/theme-chalk/el-switch.css'
import 'element-plus/theme-chalk/el-table.css'
import 'element-plus/theme-chalk/el-table-column.css'
import 'element-plus/theme-chalk/el-tab-pane.css'
import 'element-plus/theme-chalk/el-tabs.css'
import 'element-plus/theme-chalk/el-tag.css'
import 'element-plus/theme-chalk/el-upload.css'

import App from './App.vue'
import router from './router'

const ELEMENT_PLUS_COMPONENTS = [
  ElAlert,
  ElBreadcrumb,
  ElBreadcrumbItem,
  ElButton,
  ElCard,
  ElCheckbox,
  ElDatePicker,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElDivider,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElOption,
  ElPagination,
  ElRadio,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTabPane,
  ElTabs,
  ElTag,
  ElUpload
]

const ELEMENT_PLUS_ICONS = {
  ArrowDown,
  Bell,
  ChatDotRound,
  Connection,
  CopyDocument,
  DataAnalysis,
  DataBoard,
  Delete,
  Document,
  Edit,
  Expand,
  Fold,
  Folder,
  Goods,
  InfoFilled,
  Link,
  Loading,
  Lock,
  Message,
  Monitor,
  Odometer,
  Plus,
  Position,
  Promotion,
  Reading,
  Refresh,
  Search,
  Setting,
  Share,
  Switch,
  SwitchButton,
  Tickets,
  Upload,
  User,
  View
}

const app = createApp(App)
const pinia = createPinia()

for (const component of ELEMENT_PLUS_COMPONENTS) {
  app.use(component)
}

app.use(ElLoading)

for (const [name, component] of Object.entries(ELEMENT_PLUS_ICONS)) {
  app.component(name, component)
}

app.use(pinia)
app.use(router)

app.mount('#app')

console.log('管理端应用启动成功')
