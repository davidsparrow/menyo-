import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { VoiceOption } from "../types";

// Helper for Live API Audio
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

function createBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Data = btoa(binary);

  return {
    data: base64Data,
    mimeType: 'audio/pcm;rate=16000',
  };
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- Main Service Class ---

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  // 1. Menu Analysis (using Vision model)
  async analyzeMenuImage(base64Image: string, mimeType: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: mimeType,
              },
            },
            {
              text: "Extract all menu items, prices, and categories from this menu image. Return a structured plain text summary suitable for a voice AI to read and understand. Include dietary info if visible.",
            },
          ],
        },
      });
      return response.text || "";
    } catch (error) {
      console.error("Error analyzing menu:", error);
      throw error;
    }
  }

  // 2. Live API Connection
  async connectLive(
    voiceName: VoiceOption,
    systemInstruction: string, // Full prompt passed from App state
    onAudioData: (buffer: AudioBuffer) => void,
    onClose: () => void
  ): Promise<{ disconnect: () => void; sendAudio: (data: Float32Array) => void }> {
    
    let nextStartTime = 0;
    const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const outputNode = outputAudioContext.createGain();
    outputNode.connect(outputAudioContext.destination); // Connect to speakers
    
    const sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } },
        },
        systemInstruction: systemInstruction, // Use the user-edited prompt directly
      },
      callbacks: {
        onopen: () => {
          console.log("Gemini Live Session Opened");
        },
        onmessage: async (message: LiveServerMessage) => {
          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          
          if (base64Audio) {
             nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
             
             const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                outputAudioContext,
                24000,
                1
             );
             
             // Fire callback for visualization
             onAudioData(audioBuffer);

             const source = outputAudioContext.createBufferSource();
             source.buffer = audioBuffer;
             source.connect(outputNode);
             source.start(nextStartTime);
             nextStartTime += audioBuffer.duration;
          }
        },
        onclose: () => {
          console.log("Gemini Live Session Closed");
          onClose();
        },
        onerror: (err) => {
          console.error("Gemini Live Error:", err);
          onClose();
        }
      }
    });

    return {
      disconnect: async () => {
        await sessionPromise;
        outputAudioContext.close();
      },
      sendAudio: (pcmData: Float32Array) => {
        const blobPayload = createBlob(pcmData);
        sessionPromise.then(session => {
            session.sendRealtimeInput({ media: blobPayload });
        });
      }
    };
  }
}

export const geminiService = new GeminiService();