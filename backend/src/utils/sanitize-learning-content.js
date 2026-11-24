const sanitizeHtml = require('sanitize-html');

// Hostnames allowed for embedded iframes (videos, interactive content).
// Extend via LEARNING_CONTENT_IFRAME_HOSTS env var (comma-separated) if needed.
const DEFAULT_IFRAME_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'player.vimeo.com',
  'vimeo.com',
];

const extraHosts = (process.env.LEARNING_CONTENT_IFRAME_HOSTS || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const allowedIframeHostnames = [...DEFAULT_IFRAME_HOSTS, ...extraHosts];

const sanitizeOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'div', 'span',
    'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'mark',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'figure', 'figcaption',
    'iframe',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    iframe: [
      'src', 'width', 'height',
      'allow', 'allowfullscreen', 'frameborder',
      'referrerpolicy', 'title', 'loading',
    ],
    '*': ['class', 'style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },
  allowedIframeHostnames,
  // Force safer defaults on links
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }, true),
  },
};

function sanitizeLearningContent(content) {
  if (content == null) return null;
  if (typeof content !== 'object') return null;

  const html = typeof content.html === 'string' ? sanitizeHtml(content.html, sanitizeOptions) : '';
  const title = typeof content.title === 'string' ? content.title.slice(0, 200) : '';

  return { html, title };
}

module.exports = { sanitizeLearningContent };
