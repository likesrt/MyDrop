// 模板系统 - 分离HTML和JS

// 模板缓存
const templateCache = new Map();

// 加载模板文件
async function loadTemplate(templatePath) {
  if (templateCache.has(templatePath)) {
    return templateCache.get(templatePath);
  }

  try {
    const response = await fetch(`/templates/components/${templatePath}.html`);
    if (!response.ok) {
      throw new Error(`Template not found: ${templatePath}`);
    }
    const template = await response.text();
    templateCache.set(templatePath, template);
    return template;
  } catch (error) {
    console.error('Failed to load template:', templatePath, error);
    return '';
  }
}

// 渲染模板并替换变量
function renderTemplate(template, data = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? data[key] : match;
  });
}

// 组合函数：加载并渲染模板
async function getTemplate(templatePath, data = {}) {
  const template = await loadTemplate(templatePath);
  return renderTemplate(template, data);
}

// 预加载常用模板
async function preloadTemplates() {
  const commonTemplates = [
    'chat-layout',
    'login-form',
    'message-item',
    'message-upload-progress',
    'message-file-uploading',
    'admin-dashboard-cards',
    'admin-message-item',
    'message-file-image',
    'message-file-video',
    'message-file-generic'
  ];

  await Promise.all(
    commonTemplates.map(template => loadTemplate(template))
  );
}

// 暴露API
window.MyDropTemplates = {
  loadTemplate,
  renderTemplate,
  getTemplate,
  preloadTemplates,
  getCached(templatePath) { return templateCache.get(templatePath) || ''; }
};
