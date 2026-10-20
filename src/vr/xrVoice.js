// VR VOICE RECORDER & REAL-TIME SPEECH-TO-TEXT
//
// Records microphone input directly from the Meta Quest 3 headset,
// transcribes spoken Portuguese via SpeechRecognition / MediaRecorder,
// and transmits user voice instructions to the development server at /api/vr-voice.

export class XrVoiceManager {
  constructor() {
    this.isRecording = false;
    this.status = 'idle'; // 'idle' | 'requesting' | 'recording' | 'sending' | 'sent' | 'error'
    this.statusMessage = '🎙️ Segure para falar com a IA';
    this.currentTranscript = '';
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.recognition = null;
    this.lastSentText = '';

    this._initSpeechRecognition();
  }

  _initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const r = new SpeechRecognition();
        r.continuous = true;
        r.interimResults = true;
        r.lang = 'pt-BR';

        r.onresult = (event) => {
          let text = '';
          for (let i = 0; i < event.results.length; i++) {
            text += event.results[i][0].transcript;
          }
          this.currentTranscript = text.trim();
          this.statusMessage = `🎙️ "${this.currentTranscript}"`;
          console.log('[VR VOICE LIVE]', this.currentTranscript);
        };

        r.onerror = (err) => {
          console.warn('[VR SPEECH ERROR]', err.error);
        };

        this.recognition = r;
      } catch (e) {
        console.warn('[VR SPEECH INIT FAILED]', e);
      }
    }
  }

  async startRecording() {
    if (this.isRecording) return;
    this.isRecording = true;
    this.status = 'requesting';
    this.statusMessage = '🎙️ Ativando microfone do Quest...';
    this.currentTranscript = '';
    this.audioChunks = [];

    try {
      if (!this.mediaStream) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
      }

      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg',
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.start(200);

      if (this.recognition) {
        try { this.recognition.start(); } catch (_) {}
      }

      this.status = 'recording';
      this.statusMessage = '🔴 GRAVANDO VOZ... Fale o que deseja mudar!';
      console.log('🎙️ [VR VOICE STARTED RECORDING]');
    } catch (err) {
      console.error('[VR MIC ACCESS ERROR]', err);
      this.isRecording = false;
      this.status = 'error';
      this.statusMessage = `❌ Erro no microfone: ${err.message || err}`;
    }
  }

  async stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.status = 'sending';
    this.statusMessage = '⏳ Enviando instrução para a IA...';

    if (this.recognition) {
      try { this.recognition.stop(); } catch (_) {}
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    // Wait a brief moment for final audio chunks and speech tokens to arrive
    await new Promise((resolve) => setTimeout(resolve, 300));

    const finalTranscript = this.currentTranscript.trim();
    let audioBase64 = null;

    if (this.audioChunks.length > 0) {
      try {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        audioBase64 = await this._blobToBase64(audioBlob);
      } catch (e) {
        console.warn('[AUDIO BLOB ERROR]', e);
      }
    }

    this.lastSentText = finalTranscript || '(Áudio gravado no Quest sem transcrição de texto)';

    console.log(`📤 [VR VOICE TRANSMITTING]: "${this.lastSentText}"`);

    // Transmit to dev server
    try {
      const resp = await fetch('/api/vr-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: this.lastSentText,
          audioBase64,
          timestamp: Date.now(),
        }),
      });

      if (resp.ok) {
        this.status = 'sent';
        this.statusMessage = `✅ ENVIADO! A IA está ajustando: "${this.lastSentText}"`;
      } else {
        this.status = 'error';
        this.statusMessage = '⚠️ Falha ao entregar áudio no servidor';
      }
    } catch (err) {
      console.error('[VR VOICE SEND ERROR]', err);
      this.status = 'error';
      this.statusMessage = `❌ Erro de rede: ${err.message}`;
    }

    // Reset status back to idle after 6 seconds
    setTimeout(() => {
      if (!this.isRecording) {
        this.status = 'idle';
        this.statusMessage = '🎙️ Segure o Grip para falar com a IA';
      }
    }, 6000);
  }

  _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
