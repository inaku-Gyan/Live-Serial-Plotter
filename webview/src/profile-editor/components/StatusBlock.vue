<script setup lang="ts">
defineProps<{
  text: string;
}>();
</script>

<template>
  <pre class="profile-status">{{ text }}</pre>
</template>
