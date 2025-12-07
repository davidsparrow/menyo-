import React, { useState } from 'react';
import QRCode from 'react-qr-code';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Phone, ExternalLink, Settings, Play, StopCircle, Mic, MonitorPlay, MessageSquare } from 'lucide-react';
import { RestaurantProfile } from '../types';
import { geminiService } from '../services/geminiService';

interface DashboardProps {
  profile: RestaurantProfile;
  onDeploy: () => void;
  onTextChat: () => void;
}

const mockData = [
  { name: 'Mon', calls: 12 },
  { name: 'Tue', calls: 19 },
  { name: 'Wed', calls: 15 },
  { name: 'Thu', calls: 25 },
  { name: 'Fri', calls: 45 },
  { name: 'Sat', calls: 60 },
  { name: 'Sun', calls: 30 },
];

export const Dashboard: React.FC<DashboardProps> = ({ profile, onDeploy, onTextChat }) => {
  const [isLiveDemoActive, setIsLiveDemoActive] = useState(false);
  const [liveClient, setLiveClient] = useState<{ disconnect: () => void; sendAudio: (d: Float32Array) => void } | null>(null);
  const [volume, setVolume] = useState(0);

  const startLiveDemo = async () => {
    try {
      setIsLiveDemoActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      // Using ScriptProcessor as per Live API guidance for simplicity in this demo, 
      // although AudioWorklet is preferred for production.
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      const client = await geminiService.connectLive(
        profile.voiceId as any,
        profile.editableSystemPrompt, // Use the finalized edited prompt
        (buffer) => {
             // Simple visualizer hook
             const data = buffer.getChannelData(0);
             let sum = 0;
             for(let i=0; i<data.length;i++) sum += Math.abs(data[i]);
             setVolume(Math.min((sum / data.length) * 500, 100)); // Amplify for visual
        },
        () => {
          setIsLiveDemoActive(false);
          setLiveClient(null);
          stream.getTracks().forEach(t => t.stop());
          audioContext.close();
        }
      );

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        client.sendAudio(inputData);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setLiveClient(client);

    } catch (err) {
      console.error("Failed to start live demo", err);
      setIsLiveDemoActive(false);
      alert("Could not access microphone. Please allow permissions.");
    }
  };

  const stopLiveDemo = () => {
    if (liveClient) {
      liveClient.disconnect();
      setLiveClient(null);
    }
    setIsLiveDemoActive(false);
    setVolume(0);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="mb-8 flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">menyo! Dashboard</h1>
          <p className="text-slate-500">Welcome back, {profile.info.name}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            Voice Bot Active
          </div>
          <button 
             onClick={onDeploy}
             className="bg-slate-900 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-slate-800 transition"
          >
             <MonitorPlay className="w-4 h-4" /> Deploy Kiosk
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Stats & Integrations */}
        <div className="lg:col-span-2 space-y-6">
          {/* Analytics */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold mb-4">Call Volume (Last 7 Days)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mockData}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} />
                  <Tooltip cursor={{fill: '#f1f5f9'}} />
                  <Bar dataKey="calls" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Integration Status */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold mb-4">Active Integrations</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded flex items-center justify-center font-bold">G</div>
                  <span>Google Business Profile</span>
                </div>
                <span className="text-green-600 text-sm font-medium">Synced</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-orange-100 text-orange-600 rounded flex items-center justify-center font-bold">GF</div>
                  <span>Gloria Foods (Orders/Reservations)</span>
                </div>
                <span className={profile.integrations.gloriaFoods ? "text-green-600 text-sm font-medium" : "text-slate-400 text-sm"}>
                   {profile.integrations.gloriaFoods ? 'Connected' : 'Not Connected'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Test & QR */}
        <div className="space-y-6">
          
          {/* Live Simulator */}
          <div className="bg-brand-900 text-white p-6 rounded-xl shadow-lg relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-xl font-bold mb-2">Test Your Voice Bot</h3>
              <p className="text-brand-100 mb-6 text-sm">
                Speak directly to your configured agent using Gemini Native Audio. This simulates a customer call.
              </p>
              
              <div className="space-y-3">
                {!isLiveDemoActive ? (
                  <button 
                    onClick={startLiveDemo}
                    className="w-full bg-white text-brand-600 py-3 rounded-lg font-bold hover:bg-brand-50 transition flex items-center justify-center gap-2"
                  >
                    <Phone className="w-5 h-5" />
                    Start Voice Call
                  </button>
                ) : (
                  <div className="text-center">
                    <div className="mb-6 flex justify-center items-center h-24">
                      {/* Visualizer */}
                      <div 
                        className="rounded-full bg-white/20 transition-all duration-75"
                        style={{
                          width: `${50 + volume}px`,
                          height: `${50 + volume}px`
                        }}
                      />
                    </div>
                    <p className="mb-4 text-brand-200 animate-pulse">Listening & Speaking...</p>
                    <button 
                      onClick={stopLiveDemo}
                      className="w-full bg-red-500 text-white py-3 rounded-lg font-bold hover:bg-red-600 transition flex items-center justify-center gap-2"
                    >
                      <StopCircle className="w-5 h-5" />
                      End Call
                    </button>
                  </div>
                )}
                
                <button 
                   onClick={onTextChat}
                   className="w-full bg-brand-800 text-brand-100 py-3 rounded-lg font-bold hover:bg-brand-700 transition flex items-center justify-center gap-2"
                >
                   <MessageSquare className="w-5 h-5" />
                   Test Text Chat
                </button>
              </div>
            </div>
            
            {/* Decoration */}
            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-white/5 rounded-full blur-3xl"></div>
          </div>

          {/* QR Code */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col items-center text-center">
            <h3 className="text-lg font-bold mb-4">Customer Access Point</h3>
            <p className="text-sm text-slate-500 mb-6">
              Place this QR code on tables. It dials your AI agent immediately.
            </p>
            <div className="p-4 bg-white border-2 border-slate-900 rounded-lg mb-4">
               <QRCode 
                value={`tel:${profile.phoneNumber}`} 
                size={180}
                viewBox={`0 0 256 256`}
                />
            </div>
            {/* CHUNKY PHONE NUMBER */}
            <p className="text-3xl font-black tracking-widest text-slate-900 mt-2 font-mono">
               {profile.phoneNumber || '---'}
            </p>
            <button className="mt-6 text-brand-600 text-sm font-medium flex items-center gap-1 hover:underline">
              <ExternalLink className="w-3 h-3" /> Download High-Res
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};