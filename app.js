import { FilesetResolver, LlmInference } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.25';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.25/wasm';
const STORAGE_KEY_MODEL_URL = 'gemma3n_demo_model_url';
const STORAGE_KEY_CONTEXT = 'gemma3n_demo_context';

const ui = {
  browserStatus: document.getElementById('browserStatus'),
  isolationStatus: document.getElementById('isolationStatus'),
  modelStatus: document.getElementById('modelStatus'),
  modelUrl: document.getElementById('modelUrl'),
  modelFile: document.getElementById('modelFile'),
  maxTokens: document.getElementById('maxTokens'),
  temperature: document.getElementById('temperature'),
  initModelBtn: document.getElementById('initModelBtn'),
  disposeModelBtn: document.getElementById('disposeModelBtn'),
  recordBtn: document.getElementById('recordBtn'),
  stopBtn: document.getElementById('stopBtn'),
  clearAudioBtn: document.getElementById('clearAudioBtn'),
  audioFile: document.getElementById('audioFile'),
  audioPreview: document.getElementById('audioPreview'),
  audioDuration: document.getElementById('audioDuration'),
  audioRate: document.getElementById('audioRate'),
  audioChannels: document.getElementById('audioChannels'),
  specialty: document.getElementById('specialty'),
  noteStyle: document.getElementById('noteStyle'),
  contextNotes: document.getElementById('contextNotes'),
  transcribeBtn: document.getElementById('transcribeBtn'),
  copyTranscriptBtn: document.getElementById('copyTranscriptBtn'),
  transcript: document.getElementById('transcript'),
  soapBtn: document.getElementById('soapBtn'),
  runAllBtn: document.getElementById('runAllBtn'),
  copySoapBtn: document.getElementById('copySoapBtn'),
  downloadSoapBtn: document.getElementById('downloadSoapBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  soapNote: document.getElementById('soapNote'),
  log: document.getElementById('log'),
};

const state = {
  genaiFileset: null,
  llm: null,
  busy: false,
  mediaRecorder: null,
  mediaStream: null,
  recordingMimeType: '',
  audioChunks: [],
  audioBlob: null,
  audioBuffer: null,
  audioContext: null,
};

function log(message) {
  const stamp = new Date().toLocaleTimeString();
  ui.log.textContent += `[${stamp}] ${message}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

function setPill(element, text, kind = '') {
  element.textContent = text;
  element.className = `status-pill${kind ? ` ${kind}` : ''}`;
}

function getAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new AudioContext();
  }
  return state.audioContext;
}

function saveUserPrefs() {
  localStorage.setItem(STORAGE_KEY_MODEL_URL, ui.modelUrl.value.trim());
  localStorage.setItem(STORAGE_KEY_CONTEXT, ui.contextNotes.value);
}

function restoreUserPrefs() {
  const urlParam = new URL(window.location.href).searchParams.get('model');
  ui.modelUrl.value = urlParam || localStorage.getItem(STORAGE_KEY_MODEL_URL) || '';
  ui.contextNotes.value = localStorage.getItem(STORAGE_KEY_CONTEXT) || '';
}

function checkEnvironment() {
  const hasWebGpu = typeof navigator.gpu !== 'undefined';
  if (hasWebGpu) {
    setPill(ui.browserStatus, 'WebGPU detected', 'ok');
  } else {
    setPill(ui.browserStatus, 'WebGPU not detected', 'err');
  }

  if (window.crossOriginIsolated) {
    setPill(ui.isolationStatus, 'Cross-origin isolated', 'ok');
  } else {
    setPill(ui.isolationStatus, 'Not cross-origin isolated yet', hasWebGpu ? 'warn' : 'err');
  }

  return hasWebGpu && window.crossOriginIsolated;
}

function updateButtons() {
  const hasModel = !!state.llm;
  const hasAudio = !!state.audioBuffer;
  const hasTranscript = ui.transcript.value.trim().length > 0;

  ui.disposeModelBtn.disabled = !hasModel || state.busy;
  ui.initModelBtn.disabled = state.busy;
  ui.recordBtn.disabled = state.busy || !!state.mediaRecorder;
  ui.stopBtn.disabled = !state.mediaRecorder;
  ui.clearAudioBtn.disabled = !hasAudio || state.busy;
  ui.transcribeBtn.disabled = !hasModel || !hasAudio || state.busy;
  ui.soapBtn.disabled = !hasModel || !hasTranscript || state.busy;
  ui.runAllBtn.disabled = !hasModel || !hasAudio || state.busy;
  ui.cancelBtn.disabled = !state.busy || !state.llm;
  ui.copyTranscriptBtn.disabled = !hasTranscript;
  ui.copySoapBtn.disabled = !ui.soapNote.value.trim();
  ui.downloadSoapBtn.disabled = !ui.soapNote.value.trim();
}

function setBusy(isBusy) {
  state.busy = isBusy;
  updateButtons();
}

function audioFileName() {
  return `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-soap-note.txt`;
}

function getSupportedRecordingMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];

  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

async function decodeBlobToMonoAudioBuffer(blob) {
  const audioContext = getAudioContext();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const sourceArrayBuffer = await blob.arrayBuffer();
  const decoded = await audioContext.decodeAudioData(sourceArrayBuffer.slice(0));
  const mono = audioContext.createBuffer(1, decoded.length, decoded.sampleRate);
  const monoData = mono.getChannelData(0);

  if (decoded.numberOfChannels === 1) {
    monoData.set(decoded.getChannelData(0));
  } else {
    for (let i = 0; i < decoded.length; i += 1) {
      let sum = 0;
      for (let ch = 0; ch < decoded.numberOfChannels; ch += 1) {
        sum += decoded.getChannelData(ch)[i];
      }
      monoData[i] = sum / decoded.numberOfChannels;
    }
  }

  return mono;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

async function setAudioBlob(blob) {
  state.audioBlob = blob;
  state.audioBuffer = await decodeBlobToMonoAudioBuffer(blob);

  const objectUrl = URL.createObjectURL(blob);
  ui.audioPreview.src = objectUrl;
  ui.audioDuration.textContent = formatDuration(state.audioBuffer.duration);
  ui.audioRate.textContent = `${state.audioBuffer.sampleRate} Hz`;
  ui.audioChannels.textContent = `${state.audioBuffer.numberOfChannels}`;
  log(`Loaded audio clip: ${formatDuration(state.audioBuffer.duration)}, ${state.audioBuffer.sampleRate} Hz, mono=${state.audioBuffer.numberOfChannels === 1}.`);
  updateButtons();
}

function clearAudio() {
  if (ui.audioPreview.src) {
    URL.revokeObjectURL(ui.audioPreview.src);
  }
  state.audioBlob = null;
  state.audioBuffer = null;
  ui.audioPreview.removeAttribute('src');
  ui.audioPreview.load();
  ui.audioDuration.textContent = '—';
  ui.audioRate.textContent = '—';
  ui.audioChannels.textContent = '—';
  updateButtons();
}

async function initializeModel() {
  const envOk = checkEnvironment();
  if (!envOk) {
    throw new Error('Chrome must have WebGPU enabled and the page must be cross-origin isolated.');
  }

  const localFile = ui.modelFile.files?.[0] || null;
  const modelUrl = ui.modelUrl.value.trim();
  if (!localFile && !modelUrl) {
    throw new Error('Provide either a public model URL or a local .litertlm file.');
  }

  saveUserPrefs();
  setBusy(true);
  setPill(ui.modelStatus, 'Initializing model…', 'warn');
  log('Resolving MediaPipe GenAI wasm files.');

  if (!state.genaiFileset) {
    state.genaiFileset = await FilesetResolver.forGenAiTasks(WASM_ROOT);
  }

  const baseOptions = localFile
    ? { modelAssetBuffer: localFile.stream().getReader() }
    : { modelAssetPath: modelUrl };

  const options = {
    baseOptions,
    maxTokens: Number(ui.maxTokens.value) || 1536,
    topK: 40,
    temperature: Number(ui.temperature.value) || 0.2,
    randomSeed: 101,
    supportAudio: true,
  };

  log(localFile
    ? `Loading local model file: ${localFile.name}`
    : `Loading model from URL: ${modelUrl}`);

  state.llm = await LlmInference.createFromOptions(state.genaiFileset, options);
  setPill(ui.modelStatus, 'Model ready', 'ok');
  log('Model initialized successfully.');
  setBusy(false);
  updateButtons();
}

function disposeModel() {
  if (!state.llm) return;
  try {
    if (typeof state.llm.close === 'function') {
      state.llm.close();
    }
  } catch (error) {
    log(`Non-fatal unload warning: ${error.message}`);
  }
  state.llm = null;
  setPill(ui.modelStatus, 'Model unloaded', 'warn');
  updateButtons();
}

function wrapUserTurn(content) {
  return `<start_of_turn>user\n${content}<end_of_turn>\n<start_of_turn>model\n`;
}

async function generateText(input, outputElement) {
  if (!state.llm) throw new Error('Model is not initialized.');
  setBusy(true);
  outputElement.value = '';

  try {
    await state.llm.generateResponse(input, (partialResult, done) => {
      outputElement.value += partialResult;
      if (done) {
        setBusy(false);
        updateButtons();
      }
    });
  } catch (error) {
    setBusy(false);
    updateButtons();
    throw error;
  }
}

function buildTranscriptPrompt() {
  const specialty = ui.specialty.value === 'Custom' ? 'medical' : ui.specialty.value;
  const context = ui.contextNotes.value.trim();

  const instruction = [
    `You are an on-device ${specialty} medical transcription assistant.`,
    'Transcribe the attached dictated clinical audio into a clean, faithful transcript.',
    'Rules:',
    '- Do not invent information.',
    '- Keep medical terms, drug names, numbers, and units when spoken.',
    '- If a segment is unclear, write [inaudible] rather than guessing.',
    '- Remove filler words only when they do not change meaning.',
    '- Return only the transcript and no preamble.',
    context ? `Additional context: ${context}` : '',
  ].filter(Boolean).join('\n');

  return [
    '<start_of_turn>user\n',
    instruction + '\n',
    { audioSource: state.audioBuffer },
    '<end_of_turn>\n<start_of_turn>model\n',
  ];
}

function buildSoapPrompt(transcript) {
  const specialty = ui.specialty.value;
  const noteStyle = ui.noteStyle.value;
  const context = ui.contextNotes.value.trim();

  return wrapUserTurn([
    `You are an expert ${specialty} clinical documentation assistant.`,
    `Create a ${noteStyle} SOAP note from the transcript below.`,
    'Rules:',
    '- Use only information present in the transcript.',
    '- Never fabricate vitals, lab values, exam findings, medication doses, diagnoses, or follow-up intervals.',
    '- If information is missing, explicitly write "Not stated."',
    '- Use clear section headers: Subjective, Objective, Assessment, Plan.',
    '- In Assessment and Plan, organize problems as numbered items when possible.',
    '- Keep the note clinically polished and easy to read.',
    context ? `Additional context: ${context}` : '',
    '',
    'Transcript:',
    transcript,
  ].filter(Boolean).join('\n'));
}

async function transcribeAudio() {
  if (!state.audioBuffer) throw new Error('No audio available.');
  log('Starting transcription.');
  await generateText(buildTranscriptPrompt(), ui.transcript);
  ui.transcript.value = ui.transcript.value.trim();
  log('Transcription finished.');
  updateButtons();
}

async function generateSoap() {
  const transcript = ui.transcript.value.trim();
  if (!transcript) throw new Error('Transcript is empty.');
  log('Generating SOAP note.');
  await generateText(buildSoapPrompt(transcript), ui.soapNote);
  ui.soapNote.value = ui.soapNote.value.trim();
  log('SOAP note generation finished.');
  updateButtons();
}

async function runAll() {
  await transcribeAudio();
  await generateSoap();
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone recording is not available in this browser.');
  }

  clearAudio();
  state.audioChunks = [];
  state.recordingMimeType = getSupportedRecordingMimeType();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.mediaStream = stream;

  state.mediaRecorder = state.recordingMimeType
    ? new MediaRecorder(stream, { mimeType: state.recordingMimeType })
    : new MediaRecorder(stream);

  state.mediaRecorder.ondataavailable = (event) => {
    if (event.data?.size) {
      state.audioChunks.push(event.data);
    }
  };

  state.mediaRecorder.onstop = async () => {
    try {
      const blob = new Blob(state.audioChunks, {
        type: state.recordingMimeType || state.mediaRecorder.mimeType || 'audio/webm',
      });
      await setAudioBlob(blob);
      log('Recording stopped and audio decoded successfully.');
    } catch (error) {
      log(`Failed to decode recorded audio: ${error.message}`);
      alert(`Failed to decode recorded audio: ${error.message}`);
    } finally {
      state.mediaStream?.getTracks().forEach(track => track.stop());
      state.mediaStream = null;
      state.mediaRecorder = null;
      state.audioChunks = [];
      updateButtons();
    }
  };

  state.mediaRecorder.start();
  log('Recording started.');
  updateButtons();
}

function stopRecording() {
  if (!state.mediaRecorder) return;
  state.mediaRecorder.stop();
  log('Stopping recording…');
}

async function loadAudioFile(file) {
  clearAudio();
  await setAudioBlob(file);
}

async function copyText(text, label) {
  await navigator.clipboard.writeText(text);
  log(`${label} copied to clipboard.`);
}

function downloadSoapNote() {
  const blob = new Blob([ui.soapNote.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = audioFileName();
  anchor.click();
  URL.revokeObjectURL(url);
  log('SOAP note downloaded.');
}

function cancelGeneration() {
  if (!state.llm) return;
  try {
    state.llm.cancelProcessing();
    log('Generation cancelled.');
  } catch (error) {
    log(`Cancel warning: ${error.message}`);
  } finally {
    setBusy(false);
    updateButtons();
  }
}

async function safeAction(fn) {
  try {
    await fn();
  } catch (error) {
    log(`Error: ${error.message}`);
    alert(error.message);
    setBusy(false);
    updateButtons();
  }
}

function bindEvents() {
  ui.initModelBtn.addEventListener('click', () => safeAction(initializeModel));
  ui.disposeModelBtn.addEventListener('click', () => disposeModel());
  ui.recordBtn.addEventListener('click', () => safeAction(startRecording));
  ui.stopBtn.addEventListener('click', () => stopRecording());
  ui.clearAudioBtn.addEventListener('click', () => clearAudio());
  ui.audioFile.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      await safeAction(() => loadAudioFile(file));
    }
  });
  ui.transcribeBtn.addEventListener('click', () => safeAction(transcribeAudio));
  ui.soapBtn.addEventListener('click', () => safeAction(generateSoap));
  ui.runAllBtn.addEventListener('click', () => safeAction(runAll));
  ui.cancelBtn.addEventListener('click', () => cancelGeneration());
  ui.copyTranscriptBtn.addEventListener('click', () => safeAction(() => copyText(ui.transcript.value, 'Transcript')));
  ui.copySoapBtn.addEventListener('click', () => safeAction(() => copyText(ui.soapNote.value, 'SOAP note')));
  ui.downloadSoapBtn.addEventListener('click', () => downloadSoapNote());
  ui.transcript.addEventListener('input', updateButtons);
  ui.soapNote.addEventListener('input', updateButtons);
  ui.modelUrl.addEventListener('change', saveUserPrefs);
  ui.contextNotes.addEventListener('change', saveUserPrefs);
}

function init() {
  restoreUserPrefs();
  bindEvents();
  checkEnvironment();
  updateButtons();
  log('App loaded.');
  log(`WebGPU available: ${typeof navigator.gpu !== 'undefined'}`);
  log(`crossOriginIsolated: ${window.crossOriginIsolated}`);
}

init();
