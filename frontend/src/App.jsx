import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import Settings from './components/Settings';
import { api } from './api';
import { SYSTEM_INFO_POLL_MS, shouldPollSystemInfo } from './utils/systemInfoPolling';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [localModels, setLocalModels] = useState([]);
  const [allModels, setAllModels] = useState([]);
  const [systemInfo, setSystemInfo] = useState(null);
  const [pullingModel, setPullingModel] = useState(null);
  const [pullProgress, setPullProgress] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const currentConversationIdRef = useRef(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  async function handlePullModel(modelName) {
    if (!modelName) return;
    setPullingModel(modelName);
    setPullProgress({ status: 'Connecting...' });
    
    try {
      await api.pullModel(modelName, (progress) => {
        if (progress.status === 'cancelled') {
          setPullingModel(null);
          setPullProgress(null);
          return;
        }

        if (progress.error) {
          setPullingModel(null);
          setPullProgress(null);
          alert(`Pull failed: ${progress.error}`);
          return;
        }

        setPullProgress(progress);

        if (progress.status === 'success') {
          setPullingModel(null);
          setPullProgress(null);
          loadLocalModels();
        }
      });
    } catch (error) {
      setPullingModel(null);
      setPullProgress(null);
      console.error('Failed to pull model:', error);
    }
  }

  async function handleCancelPull(modelName) {
    try {
      await api.cancelModelPull(modelName);
      setPullingModel(null);
      setPullProgress(null);
    } catch (error) {
      console.error('Failed to cancel pull:', error);
    }
  }

  async function loadSystemInfo() {
    try {
      const status = await api.getSystemStatus();
      setSystemInfo(status.system);
    } catch (error) {
      console.error('Failed to load system info:', error);
    }
  }

  async function loadLocalModels() {
    try {
      const response = await api.listAllModels();
      setLocalModels(response.local || []);
      setAllModels(response.all || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  }

  async function loadConversations() {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  }

  async function loadConversation(id) {
    try {
      const conv = await api.getConversation(id);
      if (currentConversationIdRef.current === id) {
        setCurrentConversation(conv);
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  }

  // Load conversations and models on mount
  useEffect(() => {
    const initializeApp = async () => {
      await loadConversations();
      await loadLocalModels();
      await loadSystemInfo();

      try {
        const active = await api.getActivePulls();
        const models = Object.keys(active);
        if (models.length > 0) {
          const modelName = models[0];
          setPullingModel(modelName);
          setPullProgress({ status: 'Connecting...' });
          await api.pullModel(modelName, (progress) => {
            if (progress.status === 'cancelled') {
              setPullingModel(null);
              setPullProgress(null);
              return;
            }

            if (progress.error) {
              setPullingModel(null);
              setPullProgress(null);
              alert(`Pull failed: ${progress.error}`);
              return;
            }

            setPullProgress(progress);

            if (progress.status === 'success') {
              setPullingModel(null);
              setPullProgress(null);
              loadLocalModels();
            }
          });
        }
      } catch (error) {
        console.error('Failed to resume active pulls:', error);
      }
    };

    initializeApp();
  }, []);

  useEffect(() => {
    let intervalId = null;

    const pollSystemInfo = () => {
      if (!shouldPollSystemInfo(document.visibilityState)) {
        return;
      }
      loadSystemInfo();
    };

    pollSystemInfo();
    intervalId = window.setInterval(pollSystemInfo, SYSTEM_INFO_POLL_MS);

    const handleVisibilityChange = () => {
      if (shouldPollSystemInfo(document.visibilityState)) {
        loadSystemInfo();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      const fetchConversation = async () => {
        await loadConversation(currentConversationId);
      };
      fetchConversation();
    }
  }, [currentConversationId]);

  const handleNewConversation = async () => {
    try {
      setIsLoading(false);
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setIsLoading(false);
    setCurrentConversationId(id);
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      alert('Failed to delete conversation');
    }
  };

  const handleSendMessage = async (
    content,
    manualResponses = null,
    chairmanModel = null,
    councilModels = null,
    synthesisProfile = 'auto',
    files = null
  ) => {
    if (!currentConversationId) return;

    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...(prev ?? { id: currentConversationId, title: '', messages: [] }),
        messages: [...(prev?.messages ?? []), userMessage],
      }));

      // Create a partial assistant message
      const tempStage1 = [...(manualResponses || [])];
      if (files && files.length > 0) {
        files.forEach((f) => {
          tempStage1.push({ model: f.name, response: `Uploading and extracting text from ${f.name}...` });
        });
      }

      const assistantMessage = {
        role: 'assistant',
        stage1: tempStage1.length > 0 ? tempStage1 : null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: {
          stage1: !(manualResponses || (files && files.length > 0)),
          stage2: false,
          stage3: false,
        },
      };

      setCurrentConversation((prev) => ({
        ...(prev ?? { id: currentConversationId, title: '', messages: [] }),
        messages: [...(prev?.messages ?? []), assistantMessage],
      }));

      if (manualResponses || (files && files.length > 0)) {
        // Handle manual response submission (with or without files)
        const result = await api.sendManualMessageWithFiles(
          currentConversationId,
          content,
          files,
          manualResponses,
          chairmanModel,
          synthesisProfile,
        );
        
        setCurrentConversation((prev) => {
          if (!prev) return prev;
          const messages = [...prev.messages];
          const lastMsg = messages[messages.length - 1];
          lastMsg.stage1 = result.stage1;
          lastMsg.stage2 = result.stage2;
          lastMsg.stage3 = result.stage3;
          lastMsg.metadata = result.metadata;
          lastMsg.loading.stage1 = false;
          lastMsg.loading.stage2 = false;
          lastMsg.loading.stage3 = false;
          return { ...prev, messages };
        });
        
        loadConversations();
        setIsLoading(false);
      } else {
        // Send message with streaming (Auto Mode)
        const requestParams = {
          content,
          chairman_model: chairmanModel,
          council_models: councilModels,
          synthesis_profile: synthesisProfile,
        };

        await api.sendMessageStream(currentConversationId, requestParams, (eventType, event) => {
          switch (eventType) {
            case 'stage1_start':
              setCurrentConversation((prev) => {
                if (!prev) return prev;
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.stage1 = true;
                return { ...prev, messages };
              });
              break;

            case 'stage1_complete':
              setCurrentConversation((prev) => {
                if (!prev) return prev;
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.stage1 = event.data;
                lastMsg.loading.stage1 = false;
                return { ...prev, messages };
              });
              break;

            case 'stage2_start':
              setCurrentConversation((prev) => {
                if (!prev) return prev;
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.stage2 = true;
                return { ...prev, messages };
              });
              break;

            case 'stage2_complete':
              setCurrentConversation((prev) => {
                if (!prev) return prev;
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.stage2 = event.data;
                lastMsg.metadata = event.metadata;
                lastMsg.loading.stage2 = false;
                return { ...prev, messages };
              });
              break;

            case 'stage3_start':
              setCurrentConversation((prev) => {
                if (!prev) return prev;
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.stage3 = true;
                return { ...prev, messages };
              });
              break;

            case 'stage3_complete':
              setCurrentConversation((prev) => {
                if (!prev) return prev;
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.stage3 = event.data;
                lastMsg.loading.stage3 = false;
                return { ...prev, messages };
              });
              break;

            case 'title_complete':
              loadConversations();
              break;

            case 'complete':
              loadConversations();
              setIsLoading(false);
              break;

            case 'error':
              console.error('Stream error:', event.message);
              setIsLoading(false);
              break;

            default:
              console.log('Unknown event type:', eventType);
          }
        });
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setCurrentConversation((prev) => ({
        ...(prev ?? { id: currentConversationId, title: '', messages: [] }),
        messages: (prev?.messages ?? []).slice(0, -2),
      }));
      setIsLoading(false);
    }
  };

  const handleRetrySynthesis = async (chairmanModel = null, synthesisProfile = 'auto') => {
    if (!currentConversationId) return;

    setIsLoading(true);
    try {
      // Set loading state for stage 3 while preserving the rest of the message
      setCurrentConversation((prev) => {
        if (!prev) return prev;
        const messages = [...prev.messages];
        const lastMsgIdx = messages.length - 1;
        if (lastMsgIdx >= 0 && messages[lastMsgIdx].role === 'assistant') {
          messages[lastMsgIdx] = {
            ...messages[lastMsgIdx],
            stage3: null,
            loading: {
              ...(messages[lastMsgIdx].loading || {}),
              stage3: true
            }
          };
        }
        return { ...prev, messages };
      });

      const result = await api.retrySynthesis(currentConversationId, chairmanModel, synthesisProfile);

      setCurrentConversation((prev) => {
        if (!prev) return prev;
        const messages = [...prev.messages];
        const lastMsgIdx = messages.length - 1;
        if (lastMsgIdx >= 0 && messages[lastMsgIdx].role === 'assistant') {
          messages[lastMsgIdx] = {
            ...messages[lastMsgIdx],
            stage3: result.stage3,
            loading: {
              ...(messages[lastMsgIdx].loading || {}),
              stage3: false
            }
          };
        }
        return { ...prev, messages };
      });
      await loadConversation(currentConversationId);
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to retry synthesis:', error);
      setIsLoading(false);
      setCurrentConversation((prev) => {
        if (!prev) return prev;
        const messages = [...prev.messages];
        const lastMsgIdx = messages.length - 1;
        if (lastMsgIdx >= 0 && messages[lastMsgIdx].role === 'assistant') {
          messages[lastMsgIdx] = {
            ...messages[lastMsgIdx],
            stage3: { model: 'error', response: 'Retry failed. Please check backend logs.' },
            loading: {
              ...(messages[lastMsgIdx].loading || {}),
              stage3: false
            }
          };
        }
        return { ...prev, messages };
      });
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onOpenSettings={() => setShowSettings(true)}
        onDeleteConversation={handleDeleteConversation}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        onRetrySynthesis={handleRetrySynthesis}
        localModels={allModels}
        systemInfo={systemInfo}
        pullingModel={pullingModel}
        pullProgress={pullProgress}
        onPullModel={handlePullModel}
        onCancelPull={handleCancelPull}
        isLoading={isLoading}
        onOpenSettings={() => setShowSettings(true)}
      />
      {showSettings && (
        <Settings 
          onClose={() => setShowSettings(false)} 
          onModelsChanged={loadLocalModels}
          localModels={localModels}
          pullingModel={pullingModel}
          pullProgress={pullProgress}
          onPullModel={handlePullModel}
          onCancelPull={handleCancelPull}
        />
      )}
    </div>
  );
}

export default App;
