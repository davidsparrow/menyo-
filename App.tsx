import React, { useState } from 'react';
import { Upload, Check, Store, Link2, Phone, Mic, ArrowRight, Loader2, KeyRound } from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { geminiService } from './services/geminiService';
import { RestaurantProfile, VoiceOption } from './types';

function App() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [gloriaInput, setGloriaInput] = useState('');
  const [profile, setProfile] = useState<RestaurantProfile>({
    id: 'rest_123',
    info: {
      name: '',
      address: '',
      hours: '',
      phone: '',
      website: '',
      cuisine: '',
    },
    menuContext: '',
    integrations: {
      googleBusiness: false,
      gloriaFoods: false,
      twilio: false,
    },
    voiceId: VoiceOption.Zephyr,
    phoneNumber: null,
  });

  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // --- Handlers ---

  const handleMenuUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      setUploadedFileName(file.name);
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = (reader.result as string).split(',')[1];
        // Send to Gemini to extract text
        const extractedText = await geminiService.analyzeMenuImage(base64String, file.type);
        setProfile(prev => ({ ...prev, menuContext: extractedText }));
        setLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setLoading(false);
      alert('Failed to process menu image.');
    }
  };

  const handleInfoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProfile(prev => ({
      ...prev,
      info: { ...prev.info, [e.target.name]: e.target.value }
    }));
  };

  const syncGoogleBusiness = async () => {
    setLoading(true);
    // Simulate API delay
    await new Promise(r => setTimeout(r, 1500));
    setProfile(prev => ({
      ...prev,
      info: {
        ...prev.info,
        name: "Joe's Bistro",
        address: "123 Main St, San Francisco, CA",
        hours: "Mon-Sun 9am - 10pm",
        website: "www.joesbistro.com",
        cuisine: "Italian-American"
      },
      integrations: { ...prev.integrations, googleBusiness: true }
    }));
    setLoading(false);
  };

  const connectGloriaFoods = async () => {
    if (!gloriaInput.trim()) return;
    setLoading(true);
    
    // Simulate Gloria Foods API validation and sync
    await new Promise(r => setTimeout(r, 2000));
    
    setProfile(prev => ({
      ...prev,
      gloriaFoodsToken: gloriaInput,
      integrations: { ...prev.integrations, gloriaFoods: true },
      // Append integration context for the AI
      menuContext: prev.menuContext + `\n\n[SYSTEM: INTEGRATION ACTIVE]\nGloria Foods Ordering & Reservations are CONNECTED.\n- Use the 'gloria_order' tool for placing orders (simulated).\n- Use 'gloria_reserve' for tables.\n- Verify table availability automatically.`
    }));
    setLoading(false);
  };

  const getTwilioNumber = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    setProfile(prev => ({
      ...prev,
      phoneNumber: "+1 (415) 555-0199",
      integrations: { ...prev.integrations, twilio: true }
    }));
    setLoading(false);
  };

  const nextStep = () => setStep(prev => prev + 1);

  // --- Render Steps ---

  const renderStep1_Menu = () => (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Upload Your Menu</h2>
        <p className="text-slate-500 text-lg">
          We use Gemini Vision to read your menu and teach the voice bot what you serve.
        </p>
      </div>
      
      <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center hover:border-brand-500 transition-all bg-slate-50 group cursor-pointer relative overflow-hidden">
        <input 
          type="file" 
          accept="image/*"
          onChange={handleMenuUpload}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
          id="menu-upload"
        />
        
        {loading ? (
          <div className="flex flex-col items-center animate-pulse">
            <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mb-6">
              <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
            </div>
            <p className="text-brand-700 font-semibold text-lg">Analyzing menu structure...</p>
            <p className="text-brand-500/70 text-sm mt-1">Powered by Gemini Vision 2.0</p>
          </div>
        ) : profile.menuContext ? (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6 shadow-sm">
              <Check className="w-8 h-8" />
            </div>
            <p className="text-slate-900 font-bold text-xl mb-2">{uploadedFileName}</p>
            <p className="text-green-600 font-medium bg-green-50 px-3 py-1 rounded-full text-sm mb-4">
              Analysis Complete
            </p>
            <p className="text-sm text-slate-400 max-w-sm">
              Extracted {profile.menuContext.length} characters of context.
            </p>
            <button 
              onClick={(e) => {
                e.preventDefault(); 
                setProfile(p => ({...p, menuContext: ''}));
              }} 
              className="mt-6 text-sm text-red-500 hover:text-red-600 font-medium z-20 relative"
            >
              Remove file
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center transition-transform group-hover:scale-105 duration-300">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-sm mb-6">
               <Upload className="w-10 h-10 text-brand-500" />
            </div>
            <p className="text-slate-900 font-bold text-xl mb-2">Click to upload menu</p>
            <p className="text-slate-500 text-base">Supports JPG, PNG (Max 10MB)</p>
          </div>
        )}
      </div>

      <div className="flex justify-end pt-4">
        <button 
          onClick={nextStep}
          disabled={!profile.menuContext}
          className="bg-brand-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-brand-500/20 transition-all hover:translate-y-[-1px]"
        >
          Continue <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  const renderStep2_Google = () => (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Sync Business Profile</h2>
        <p className="text-slate-500 text-lg">Connect Google Business to automatically pull hours, location, and cuisine.</p>
      </div>

      {!profile.integrations.googleBusiness ? (
        <button 
          onClick={syncGoogleBusiness}
          disabled={loading}
          className="w-full py-12 border-2 border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-4 hover:border-blue-400 hover:bg-blue-50/30 transition-all group bg-white"
        >
          {loading ? (
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
          ) : (
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              <Store className="w-8 h-8 text-blue-600" />
            </div>
          )}
          <div className="text-center">
             <span className="font-bold text-xl text-slate-800 block">Sync with Google Business</span>
             <span className="text-slate-400 text-sm">One-click import</span>
          </div>
        </button>
      ) : (
        <div className="bg-green-50/50 border border-green-200 p-8 rounded-2xl space-y-6">
          <div className="flex items-center gap-3 text-green-700 font-bold text-lg">
            <div className="p-2 bg-green-100 rounded-full"><Check className="w-5 h-5" /></div>
            Synced Successfully
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Restaurant Name</label>
                <input value={profile.info.name} onChange={handleInfoChange} name="name" className="w-full p-3 border border-slate-200 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-green-500 outline-none transition" />
             </div>
             <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Address</label>
                <input value={profile.info.address} onChange={handleInfoChange} name="address" className="w-full p-3 border border-slate-200 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-green-500 outline-none transition" />
             </div>
             <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Hours</label>
                <input value={profile.info.hours} onChange={handleInfoChange} name="hours" className="w-full p-3 border border-slate-200 rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-green-500 outline-none transition" />
             </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center pt-6 border-t border-slate-100">
         <button onClick={() => setStep(1)} className="text-slate-400 hover:text-slate-600 font-medium px-4 py-2">Back</button>
         <button 
          onClick={nextStep}
          disabled={!profile.integrations.googleBusiness}
          className="bg-brand-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-500/20"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderStep3_Integrations = () => (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Platform Integrations</h2>
        <p className="text-slate-500 text-lg">Allow the bot to take real actions like booking tables or placing orders.</p>
      </div>

      <div className="space-y-5">
        {/* Gloria Foods Integration Card */}
        <div className={`p-8 rounded-2xl border-2 transition-all ${profile.integrations.gloriaFoods ? 'border-orange-500 bg-orange-50/30' : 'border-slate-100 bg-white hover:border-orange-200 shadow-sm'}`}>
          <div className="flex items-start justify-between mb-6">
             <div className="flex items-center gap-5">
               <div className="w-14 h-14 bg-orange-500 text-white rounded-xl flex items-center justify-center font-bold text-2xl shadow-orange-200 shadow-lg">GF</div>
               <div>
                 <h4 className="font-bold text-slate-900 text-xl">Gloria Foods</h4>
                 <p className="text-sm text-slate-500 mt-1">Reservations & Online Ordering API</p>
               </div>
             </div>
             <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors ${profile.integrations.gloriaFoods ? 'bg-orange-500 border-orange-500' : 'border-slate-200'}`}>
                {profile.integrations.gloriaFoods && <Check className="w-5 h-5 text-white" />}
             </div>
          </div>
          
          {!profile.integrations.gloriaFoods ? (
            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
              <label className="block text-xs font-bold text-slate-500 mb-3 uppercase tracking-wide">
                API Token
              </label>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <KeyRound className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input 
                    type="password" 
                    placeholder="Enter Restaurant API Token" 
                    value={gloriaInput}
                    onChange={(e) => setGloriaInput(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 transition"
                  />
                </div>
                <button 
                  onClick={connectGloriaFoods}
                  disabled={!gloriaInput || loading}
                  className="bg-orange-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-orange-500/20"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Link2 className="w-5 h-5" />}
                  Connect
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                We'll sync menu availability and table inventory automatically.
              </p>
            </div>
          ) : (
             <div className="text-sm text-green-700 font-medium flex items-center gap-2 bg-green-50 py-2 px-3 rounded-lg w-fit">
                <Check className="w-4 h-4" /> API Connected • Menu & Inventory Synced
             </div>
          )}
        </div>

        {/* Placeholder for OpenTable */}
        <div className="p-6 rounded-2xl border border-slate-100 opacity-60 cursor-not-allowed flex items-center justify-between bg-slate-50 grayscale hover:opacity-70 transition">
          <div className="flex items-center gap-5">
             <div className="w-14 h-14 bg-gray-200 rounded-xl flex items-center justify-center font-bold text-gray-400 text-xl">OT</div>
             <div>
               <h4 className="font-bold text-slate-700 text-lg">OpenTable</h4>
               <p className="text-sm text-slate-500">Coming Soon</p>
             </div>
          </div>
        </div>
      </div>

       <div className="flex justify-between items-center pt-6 border-t border-slate-100">
         <button onClick={() => setStep(2)} className="text-slate-400 hover:text-slate-600 font-medium px-4 py-2">Back</button>
         <button 
          onClick={nextStep}
          className="bg-brand-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-brand-700 shadow-lg shadow-brand-500/20"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderStep4_Phone = () => (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Provision Phone Number</h2>
        <p className="text-slate-500 text-lg">We partner with Twilio to provide a dedicated line for your AI agent.</p>
      </div>

      {!profile.phoneNumber ? (
         <div className="text-center py-16 bg-gradient-to-b from-slate-50 to-white rounded-2xl border border-slate-200">
            <div className="w-20 h-20 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
               <Phone className="w-10 h-10 text-brand-600" />
            </div>
            <p className="mb-8 font-medium text-slate-600 text-lg max-w-md mx-auto">
              Get a local number for <span className="text-slate-900 font-bold">{profile.info.address ? 'San Francisco, CA' : 'your area'}</span>
            </p>
            <button 
              onClick={getTwilioNumber}
              disabled={loading}
              className="bg-brand-600 text-white px-8 py-4 rounded-xl font-bold shadow-xl shadow-brand-500/30 hover:bg-brand-700 transition-all hover:-translate-y-1"
            >
              {loading ? <span className="flex items-center gap-2"><Loader2 className="animate-spin" /> Provisioning...</span> : 'Generate Phone Number'}
            </button>
         </div>
      ) : (
        <div className="bg-green-50 border border-green-200 p-10 rounded-2xl text-center relative overflow-hidden">
           <div className="absolute top-0 right-0 -mt-10 -mr-10 w-32 h-32 bg-green-200 rounded-full blur-3xl opacity-50"></div>
           <h3 className="text-green-800 font-bold text-lg mb-3 uppercase tracking-wide opacity-80">Number Active</h3>
           <p className="text-5xl font-mono text-slate-800 font-bold mb-6 tracking-tight">{profile.phoneNumber}</p>
           <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/60 rounded-full text-sm text-green-700 font-medium">
             <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
             Ready to receive calls
           </div>
        </div>
      )}

      <div className="flex justify-between items-center pt-6 border-t border-slate-100">
         <button onClick={() => setStep(3)} className="text-slate-400 hover:text-slate-600 font-medium px-4 py-2">Back</button>
         <button 
          onClick={nextStep}
          disabled={!profile.phoneNumber}
          className="bg-brand-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-500/20"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderStep5_Voice = () => (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Select Voice Personality</h2>
        <p className="text-slate-500 text-lg">Choose the voice that best fits your restaurant's brand.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {Object.values(VoiceOption).map((voice) => (
          <div 
            key={voice}
            onClick={() => setProfile(p => ({...p, voiceId: voice}))}
            className={`p-5 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-md ${profile.voiceId === voice ? 'border-brand-500 bg-brand-50/50' : 'border-slate-100 bg-white hover:border-slate-200'}`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${profile.voiceId === voice ? 'bg-brand-200 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                <Mic className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h4 className={`font-bold text-lg ${profile.voiceId === voice ? 'text-brand-900' : 'text-slate-800'}`}>{voice}</h4>
                <p className="text-sm text-slate-500 mt-0.5">
                  {voice === 'Puck' ? 'Playful & Energetic' : 
                   voice === 'Kore' ? 'Calm & Professional' : 
                   voice === 'Fenrir' ? 'Deep & Authoritative' : 
                   voice === 'Zephyr' ? 'Smooth & Friendly' : 'Standard'}
                </p>
              </div>
              {profile.voiceId === voice && (
                <div className="text-brand-600 bg-white rounded-full p-1 shadow-sm">
                  <Check className="w-5 h-5" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

       <div className="bg-slate-100 p-6 rounded-2xl mt-4 flex items-center justify-between">
         <div>
            <h4 className="font-bold text-slate-800 mb-1">Looking for Voice Cloning?</h4>
            <p className="text-sm text-slate-500">Clone your own voice using ElevenLabs or Cartesia.</p>
         </div>
         <button className="px-4 py-2 bg-slate-200 text-slate-500 text-sm font-bold rounded-lg uppercase tracking-wide cursor-not-allowed">Pro Only</button>
       </div>

      <div className="flex justify-between items-center pt-6 border-t border-slate-100">
         <button onClick={() => setStep(4)} className="text-slate-400 hover:text-slate-600 font-medium px-4 py-2">Back</button>
         <button 
          onClick={nextStep}
          className="bg-brand-600 text-white px-8 py-4 rounded-xl font-bold hover:bg-brand-700 shadow-xl shadow-brand-500/30 transform transition hover:-translate-y-1"
        >
          Launch Voice Bot 🚀
        </button>
      </div>
    </div>
  );

  // --- Main Render ---

  if (step > 5) {
    return <Dashboard profile={profile} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      
      {/* Dark Sidebar */}
      <div className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0 z-20 shadow-2xl">
         <div className="p-8 border-b border-slate-800/50">
           <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-900/20">
               <Mic className="w-6 h-6 text-white" />
             </div>
             <div>
               <h1 className="text-2xl font-extrabold text-white tracking-tight">menyo!</h1>
             </div>
           </div>
         </div>

         <nav className="flex-1 p-6 space-y-1 overflow-y-auto">
           {[
             { id: 1, label: 'Upload Menu' },
             { id: 2, label: 'Sync Profile' },
             { id: 3, label: 'Integrations' },
             { id: 4, label: 'Phone Setup' },
             { id: 5, label: 'Voice Config' },
           ].map((item) => {
             const isActive = step === item.id;
             const isCompleted = step > item.id;
             
             return (
               <div key={item.id} className="group flex items-center gap-4 px-4 py-4 rounded-xl transition-colors select-none">
                 {/* Number/Icon Indicator */}
                 <div className={`
                   w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300
                   ${isActive ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/40 scale-110' : 
                     isCompleted ? 'bg-green-500 text-white' : 'bg-slate-800 text-slate-500'}
                 `}>
                   {isCompleted ? <Check className="w-4 h-4" /> : item.id}
                 </div>
                 
                 {/* Text Label */}
                 <span className={`
                   font-medium text-sm transition-colors duration-300
                   ${isActive ? 'text-white' : 
                     isCompleted ? 'text-slate-400' : 'text-slate-600'}
                 `}>
                   {item.label}
                 </span>
               </div>
             );
           })}
         </nav>
         
         <div className="p-8 border-t border-slate-800/50">
           <div className="bg-slate-800/50 rounded-lg p-4 backdrop-blur-sm">
             <p className="text-xs text-slate-400 font-medium">Logged in as</p>
             <p className="text-sm text-white font-bold truncate">restaurateur@menyo.com</p>
           </div>
         </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 relative overflow-y-auto bg-slate-50">
        <div className="max-w-4xl mx-auto py-12 px-8">
          
          {/* Card Container */}
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-10 md:p-14 transition-all animate-in fade-in slide-in-from-bottom-4 duration-500">
            {step === 1 && renderStep1_Menu()}
            {step === 2 && renderStep2_Google()}
            {step === 3 && renderStep3_Integrations()}
            {step === 4 && renderStep4_Phone()}
            {step === 5 && renderStep5_Voice()}
          </div>
          
          <div className="text-center mt-8 text-slate-400 text-sm font-medium">
             Press <span className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-500 text-xs">Enter</span> to continue
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;