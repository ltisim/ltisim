/**
 * Get LTI token from URL parameters
 */
export const getLTIToken = () => {
  const urlParams = new URLSearchParams(window.location.search)
  return urlParams.get('ltik')
}

/**
 * Get stored LTI token
 */
export const getStoredToken = () => {
  return sessionStorage.getItem('ltik')
}

/**
 * Clear stored LTI token
 */
export const clearToken = () => {
  sessionStorage.removeItem('ltik')
}
