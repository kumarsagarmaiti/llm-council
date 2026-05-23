/**
 * API client for the LLM Council backend.
 */

const API_BASE = 'http://localhost:8001';

async function consumeStreamLines(response, onLine) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      onLine(line);
    }
  }

  buffer += decoder.decode();
  if (buffer) {
    onLine(buffer);
  }
}

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Delete a specific conversation.
   */
  async deleteConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
    return response.json();
  },

  /**
   * Send a message with manual responses.
   */
  async sendManualMessage(
    conversationId,
    content,
    manualResponses,
    chairmanModel = null,
    synthesisProfile = 'auto'
  ) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/manual_message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          content, 
          manual_responses: manualResponses,
          chairman_model: chairmanModel,
          synthesis_profile: synthesisProfile,
        }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send manual message');
    }
    return response.json();
  },

  /**
   * Retry the synthesis for a conversation.
   */
  async retrySynthesis(conversationId, chairmanModel = null, synthesisProfile = 'auto') {
    const url = new URL(`${API_BASE}/api/conversations/${conversationId}/retry_synthesis`);
    if (chairmanModel) {
      url.searchParams.append('chairman_model', chairmanModel);
    }
    url.searchParams.append('synthesis_profile', synthesisProfile);
    
    const response = await fetch(url, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to retry synthesis');
    }
    return response.json();
  },

  /**
   * Get system status and recommendations.
   */
  async getSystemStatus() {
    const response = await fetch(`${API_BASE}/api/system/status`);
    if (!response.ok) {
      throw new Error('Failed to get system status');
    }
    return response.json();
  },

  /**
   * Trigger Ollama installation and track logs.
   */
  async installOllama(onLog) {
    const response = await fetch(`${API_BASE}/api/system/install_ollama`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to start installation');
    }

    await consumeStreamLines(response, (line) => {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          onLog(data);
        } catch (e) {
          console.error('Failed to parse install log:', e);
        }
      }
    });
  },

  /**
   * List local Ollama models.
   */
  async listLocalModels() {
    const response = await fetch(`${API_BASE}/api/models/local`);
    if (!response.ok) {
      throw new Error('Failed to list local models');
    }
    return response.json();
  },

  /**
   * List all models (both local and cloud).
   */
  async listAllModels() {
    const response = await fetch(`${API_BASE}/api/models`);
    if (!response.ok) {
      throw new Error('Failed to list all models');
    }
    return response.json();
  },

  /**
   * Get application settings (API keys & models configuration).
   */
  async getSettings() {
    const response = await fetch(`${API_BASE}/api/settings`);
    if (!response.ok) {
      throw new Error('Failed to get settings');
    }
    return response.json();
  },

  /**
   * Save application settings.
   */
  async saveSettings(settings) {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to save settings');
    }
    return response.json();
  },

  /**
   * Get currently active model pulls.
   */
  async getActivePulls() {
    const response = await fetch(`${API_BASE}/api/models/active_pulls`);
    if (!response.ok) {
      throw new Error('Failed to get active pulls');
    }
    return response.json();
  },

  /**
   * Delete a model.
   */
  async deleteModel(modelName) {
    const response = await fetch(`${API_BASE}/api/models/${encodeURIComponent(modelName)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete model');
    }
    return response.json();
  },

  /**
   * Pull a model and track progress.
   */
  async pullModel(modelName, onProgress) {
    const response = await fetch(`${API_BASE}/api/models/pull?model_name=${encodeURIComponent(modelName)}`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to start model pull');
    }

    await consumeStreamLines(response, (line) => {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          onProgress(data);
        } catch (e) {
          console.error('Failed to parse pull progress:', e);
        }
      }
    });
  },

  /**
   * Cancel an active model pull.
   */
  async cancelModelPull(modelName) {
    const response = await fetch(`${API_BASE}/api/models/cancel_pull?model_name=${encodeURIComponent(modelName)}`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to cancel pull');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {object} params - Request parameters (content, chairman_model, council_models)
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, params, onEvent) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    await consumeStreamLines(response, (line) => {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        try {
          const event = JSON.parse(data);
          onEvent(event.type, event);
        } catch (e) {
          console.error('Failed to parse SSE event:', e);
        }
      }
    });
  },

  /**
   * Send a message with manual responses and/or uploaded files.
   */
  async sendManualMessageWithFiles(
    conversationId,
    content,
    files,
    manualResponses = null,
    chairmanModel = null,
    synthesisProfile = 'auto'
  ) {
    const formData = new FormData();
    formData.append('content', content);
    if (chairmanModel) {
      formData.append('chairman_model', chairmanModel);
    }
    formData.append('synthesis_profile', synthesisProfile);
    if (manualResponses) {
      formData.append('manual_responses', JSON.stringify(manualResponses));
    }
    if (files && files.length > 0) {
      files.forEach((file) => {
        formData.append('files', file);
      });
    }

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/manual_message_with_files`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to send manual message with files');
    }

    return response.json();
  },

  /**
   * Send markdown content and generate/download a PDF file.
   */
  async generateAndDownloadPdf(title, content) {
    const response = await fetch(`${API_BASE}/api/pdf/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, content }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate PDF');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_+|_+)/g, '');
    a.download = `${safeTitle || 'council_report'}.pdf`;
    
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};
