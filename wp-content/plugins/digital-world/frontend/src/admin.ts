import { createApp } from 'vue'
import EditorApp from './editor/EditorApp.vue'
import './editor/editor.css'

const root = document.getElementById('digital-world-editor')
if (root) {
  createApp(EditorApp).mount(root)
}
