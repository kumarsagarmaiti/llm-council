const PROVIDER_DISPLAY_NAMES = {
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'gemini': 'Gemini',
  'deepseek': 'DeepSeek',
  'openrouter': 'OpenRouter'
};

const PROVIDERS = Object.keys(PROVIDER_DISPLAY_NAMES);

/**
 * Gets a clean, short name for a model, removing any provider prefix or slash namespaces.
 * Examples:
 * - "openai:gpt-4o" -> "gpt-4o"
 * - "openrouter:openai/gpt-4o" -> "gpt-4o"
 * - "openai/gpt-4o" -> "gpt-4o"
 * - "llama3.2:latest" -> "llama3.2:latest"
 */
export function getShortModelName(modelName) {
  if (!modelName) return '';
  
  const colonIdx = modelName.indexOf(':');
  if (colonIdx > 0) {
    const prefix = modelName.substring(0, colonIdx).toLowerCase();
    if (PROVIDERS.includes(prefix)) {
      const rest = modelName.substring(colonIdx + 1);
      return rest.includes('/') ? rest.split('/')[1] : rest;
    }
  }
  
  if (modelName.includes('/')) {
    return modelName.split('/')[1];
  }
  
  return modelName;
}

/**
 * Gets a descriptive full name for a model, appending the capitalized provider.
 * Examples:
 * - "openai:gpt-4o" -> "gpt-4o (OpenAI)"
 * - "openrouter:openai/gpt-4o" -> "gpt-4o (OpenRouter)"
 * - "openai/gpt-4o" -> "gpt-4o (OpenAI)"
 * - "llama3.2:latest" -> "llama3.2:latest"
 */
export function getFullModelName(modelName) {
  if (!modelName) return '';
  
  const colonIdx = modelName.indexOf(':');
  if (colonIdx > 0) {
    const prefix = modelName.substring(0, colonIdx).toLowerCase();
    if (PROVIDERS.includes(prefix)) {
      const rest = modelName.substring(colonIdx + 1);
      const cleanName = rest.includes('/') ? rest.split('/')[1] : rest;
      const capProvider = PROVIDER_DISPLAY_NAMES[prefix] || (prefix.charAt(0).toUpperCase() + prefix.slice(1));
      return `${cleanName} (${capProvider})`;
    }
  }
  
  if (modelName.includes('/')) {
    const parts = modelName.split('/');
    const cleanName = parts[1];
    const rawProvider = parts[0].toLowerCase();
    const capProvider = PROVIDER_DISPLAY_NAMES[rawProvider] || (rawProvider.charAt(0).toUpperCase() + rawProvider.slice(1));
    return `${cleanName} (${capProvider})`;
  }
  
  return modelName;
}
