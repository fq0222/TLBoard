<template>
  <div id="app">
    <router-view />
  </div>
</template>

<script setup>
/**
 * 用户端根组件
 * 提供全局布局和路由视图
 */
</script>

<style>
/* 全局样式 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background-color: #f5f7fa;
  color: #333;
}

#app {
  min-height: 100vh;
}
</style>