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
};
