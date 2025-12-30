import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration } from "@google/genai";
import { VoiceOption } from "../types";
import type { GloriaFoodsMenu, GloriaFoodsMenuItem } from "./gloriaFoodsService";

// Helper for Live API Audio in UI
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
  // Get API key with fallback to env var (for development)
  private getApiKey(apiKey?: string): string {
    return apiKey || process.env.API_KEY || process.env.GEMINI_API_KEY || '';
  }

  // Create GoogleGenAI instance with specific API key
  private createAI(apiKey?: string): GoogleGenAI {
    const key = this.getApiKey(apiKey);
    if (!key) {
      throw new Error('Gemini API key is required. Please set it in Settings or provide GEMINI_API_KEY environment variable.');
    }
    return new GoogleGenAI({ apiKey: key });
  }

  // 1. Menu Analysis (using Vision model)
  async analyzeMenuImage(base64Image: string, mimeType: string, apiKey?: string): Promise<string> {
    try {
      const ai = this.createAI(apiKey);
      const response = await ai.models.generateContent({
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

  // 2. Configuration Assistant (Chat to JSON)
  async updateProfileViaChat(currentProfile: any, userMessage: string, apiKey?: string): Promise<any> {
    try {
      const ai = this.createAI(apiKey);
      const prompt = `
      You are a Configuration Assistant for a restaurant voice bot. 
      Your goal is to update the restaurant's policies based on the user's natural language request.

      CURRENT CONFIGURATION (JSON):
      ${JSON.stringify({ policies: currentProfile.policies, info: currentProfile.info })}

      USER REQUEST:
      "${userMessage}"

      INSTRUCTIONS:
      - Return ONLY a JSON object representing the fields that should be updated.
      - You can update nested fields inside 'policies' (dietaryRestrictions, kidsZone, accessibility, largeParties).
      - You can update 'info' fields (hours, phone, website).
      - Do NOT wrap in markdown code blocks. Just raw JSON.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
      
      const text = response.text || "{}";
      return JSON.parse(text);
    } catch (error) {
      console.error("Error updating profile via chat:", error);
      return {};
    }
  }

  // 3. Test Bot Chat (Text Mode)
  async sendChatMessage(
    history: { role: string; parts: { text: string }[] }[],
    systemInstruction: string,
    message: string,
    apiKey?: string
  ): Promise<string> {
    try {
      const ai = this.createAI(apiKey);
      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: systemInstruction,
        },
        history: history,
      });

      const response = await chat.sendMessage({ message: message });
      return response.text || "I didn't catch that.";
    } catch (error) {
      console.error("Error in chat bot:", error);
      return "Sorry, I'm having trouble processing your request right now.";
    }
  }

  // 3b. Chat with Function Calling for Order Collection
  async sendChatMessageWithFunctions(
    history: { role: string; parts: { text: string }[] }[],
    systemInstruction: string,
    message: string,
    menuData: GloriaFoodsMenu | null,
    onFunctionCall: (functionName: string, args: any) => Promise<any>,
    apiKey?: string
  ): Promise<{ text: string; functionCalls?: Array<{ name: string; args: any; result: any }> }> {
    try {
      const ai = this.createAI(apiKey);
      
      // Define function declarations for order collection
      const functionDeclarations: FunctionDeclaration[] = [
        {
          name: 'add_item_to_order',
          description: 'Add a menu item to the customer\'s order. Use this when the customer wants to order something.',
          parameters: {
            type: "object",
            properties: {
              itemId: {
                type: "string",
                description: 'The ID of the menu item to add',
              },
              quantity: {
                type: "number",
                description: 'The quantity of this item (default: 1)',
              },
              modifiers: {
                type: "array",
                description: 'Optional array of modifier selections',
                items: {
                  type: "object",
                  properties: {
                    modifierId: { type: "string" },
                    optionId: { type: "string" },
                  },
                },
              },
              specialInstructions: {
                type: "string",
                description: 'Special instructions for this specific item',
              },
            },
            required: ['itemId', 'quantity'],
          },
        },
        {
          name: 'remove_item_from_order',
          description: 'Remove an item from the customer\'s order',
          parameters: {
            type: "object",
            properties: {
              itemId: {
                type: "string",
                description: 'The ID of the menu item to remove',
              },
            },
            required: ['itemId'],
          },
        },
        {
          name: 'update_item_quantity',
          description: 'Update the quantity of an item in the order',
          parameters: {
            type: "object",
            properties: {
              itemId: {
                type: "string",
                description: 'The ID of the menu item',
              },
              quantity: {
                type: "number",
                description: 'The new quantity (remove if 0)',
              },
            },
            required: ['itemId', 'quantity'],
          },
        },
        {
          name: 'set_customer_info',
          description: 'Store customer information (name, phone, email)',
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: 'Customer\'s full name',
              },
              phone: {
                type: "string",
                description: 'Customer\'s phone number',
              },
              email: {
                type: "string",
                description: 'Customer\'s email address (optional)',
              },
            },
            required: ['name', 'phone'],
          },
        },
        {
          name: 'set_order_preferences',
          description: 'Set order type and preferences (pickup/delivery, address, special instructions)',
          parameters: {
            type: "object",
            properties: {
              orderType: {
                type: "string",
                enum: ['PICKUP', 'DELIVERY'],
                description: 'Whether this is a pickup or delivery order',
              },
              deliveryAddress: {
                type: "string",
                description: 'Delivery address (required for delivery orders)',
              },
              specialInstructions: {
                type: "string",
                description: 'Special instructions for the entire order',
              },
            },
            required: ['orderType'],
          },
        },
        {
          name: 'get_menu_items',
          description: 'Search or filter menu items by category, dietary restrictions, or keywords',
          parameters: {
            type: "object",
            properties: {
              category: {
                type: "string",
                description: 'Filter by category name (optional)',
              },
              filters: {
                type: "array",
                description: 'Filter by dietary restrictions or keywords (e.g., ["gluten-free", "vegetarian"])',
                items: { type: "string" },
              },
              limit: {
                type: "number",
                description: 'Maximum number of items to return (default: 6, can request more)',
              },
            },
          },
        },
        {
          name: 'get_menu_item_details',
          description: 'Get detailed information about a specific menu item including modifiers and options',
          parameters: {
            type: "object",
            properties: {
              itemId: {
                type: "string",
                description: 'The ID of the menu item',
              },
            },
            required: ['itemId'],
          },
        },
      ];

      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: systemInstruction,
          tools: [{ functionDeclarations }],
          functionCallingConfig: { mode: 'AUTO' },
        },
        history: history,
      });

      let response = await chat.sendMessage({ message: message });
      const functionCalls: Array<{ name: string; args: any; result: any }> = [];
      let maxIterations = 5; // Prevent infinite loops
      let iteration = 0;

      // Handle function calling loop - Gemini may call multiple functions
      while (iteration < maxIterations) {
        const candidates = response.candidates || [];
        let hasFunctionCall = false;

        for (const candidate of candidates) {
          const content = candidate.content;
          if (content?.parts) {
            for (const part of content.parts) {
              if (part.functionCall) {
                hasFunctionCall = true;
                const functionName = part.functionCall.name;
                const args = part.functionCall.args || {};
                
                // Call the handler function
                const result = await onFunctionCall(functionName, args);
                
                functionCalls.push({ name: functionName, args, result });
                
                // Send function result back to the model
                response = await chat.sendMessage({
                  parts: [{
                    functionResponse: {
                      name: functionName,
                      response: result,
                    },
                  }],
                });
                break; // Process one function call at a time
              }
            }
          }
        }

        if (!hasFunctionCall) {
          // No more function calls, get the final text response
          break;
        }

        iteration++;
      }

      // Extract text from final response
      const candidates = response.candidates || [];
      let text = "I didn't catch that.";
      for (const candidate of candidates) {
        const content = candidate.content;
        if (content?.parts) {
          for (const part of content.parts) {
            if (part.text) {
              text = part.text;
              break;
            }
          }
        }
        if (text !== "I didn't catch that.") break;
      }

      return { text, functionCalls: functionCalls.length > 0 ? functionCalls : undefined };
    } catch (error) {
      console.error("Error in chat bot with functions:", error);
      return { text: "Sorry, I'm having trouble processing your request right now." };
    }
  }

  // 4. Live API Connection
  async connectLive(
    voiceName: VoiceOption,
    systemInstruction: string, // Full prompt passed from App state
    onAudioData: (buffer: AudioBuffer) => void,
    onClose: () => void,
    apiKey?: string
  ): Promise<{ disconnect: () => void; sendAudio: (data: Float32Array) => void }> {
    
    const ai = this.createAI(apiKey);
    let nextStartTime = 0;
    const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const outputNode = outputAudioContext.createGain();
    outputNode.connect(outputAudioContext.destination); // Connect to speakers
    
    const sessionPromise = ai.live.connect({
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

  // 5. Generate Text-to-Speech (TTS) matching the Native Voice
  async generateTTS(text: string, voiceName: string, apiKey?: string): Promise<AudioBuffer> {
    try {
      const ai = this.createAI(apiKey);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: {
          parts: [{ text: text }],
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("No audio data returned");
      
      // We use a temporary context here just for decoding; playback happens in the App
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const buffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
      
      return buffer;
    } catch (error) {
      console.error("TTS Error:", error);
      throw error;
    }
  }
}

// Export singleton instance for backward compatibility
// But methods now accept apiKey parameter for tenant-specific keys
export const geminiService = new GeminiService();