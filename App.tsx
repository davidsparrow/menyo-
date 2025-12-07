
import React, { useState, useEffect, useRef } from 'react';
import { Upload, Check, Store, Link2, Phone, Mic, ArrowRight, Loader2, KeyRound, BookOpen, Edit3, Settings, Users, Accessibility, Baby, UtensilsCrossed, MessageSquare, Send, X, Bot, Save, Plug, Globe, Server, Plus, Trash2, ExternalLink, Mail, Lock, MonitorPlay, ShieldCheck, Home, ShoppingBag, Calendar, ChevronLeft, ChevronRight, Bell, Smartphone, RefreshCw, LayoutGrid, List, AlertTriangle } from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { geminiService } from './services/geminiService';
import { RestaurantProfile, VoiceOption, ConnectedApp, Reservation, Table } from './types';
import QRCode from 'react-qr-code';

function App() {
  const [view, setView] = useState<'WIZARD' | 'DASHBOARD' | 'SETTINGS' | 'DEPLOYED'>('WIZARD');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [gloriaInput, setGloriaInput] = useState('');
  
  // Settings State
  const [settingsTab, setSettingsTab] = useState<'KNOWLEDGE' | 'VOICE' | 'PHONE' | 'APPS' | 'SECURITY' | 'RESERVATIONS'>('KNOWLEDGE');
  const [chatMessage, setChatMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'assistant', text: string}[]>([
    { role: 'assistant', text: "Hi! I'm your Knowledge Base Assistant. Tell me what needs to change—like 'We no longer allow dogs' or 'We are closed on Mondays'—and I'll update your settings automatically." }
  ]);
  const [isChatProcessing, setIsChatProcessing] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Reservation Settings State
  const [reservations, setReservations] = useState<Reservation[]>([
    { id: '1', customerName: 'Alice Johnson', date: '2025-05-15', time: '18:30', partySize: 4, status: 'CONFIRMED', phone: '(555) 123-4567', notes: 'Anniversary' },
    { id: '2', customerName: 'Bob Smith', date: '2025-05-15', time: '19:00', partySize: 2, status: 'PENDING', phone: '(555) 987-6543', tableIds: ['t1'] },
    { id: '3', customerName: 'Charlie Brown', date: '2025-05-16', time: '12:00', partySize: 6, status: 'CONFIRMED', phone: '(555) 555-5555', notes: 'High chair needed' },
    { id: '4', customerName: 'Diana Ross', date: '2025-05-16', time: '19:30', partySize: 2, status: 'CANCELLED', phone: '(555) 111-2222' },
    { id: '5', customerName: 'Evan Wright', date: '2025-05-17', time: '20:00', partySize: 8, status: 'CONFIRMED', phone: '(555) 333-4444', notes: 'Birthday party' },
    { id: '6', customerName: 'Frank Overbook', date: '2025-05-15', time: '19:00', partySize: 12, status: 'PENDING', phone: '(555) 999-9999', hasConflict: true, notes: 'WARNING: Exceeds hourly capacity' },
  ]);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [isEditingReservation, setIsEditingReservation] = useState(false);
  const [resViewMode, setResViewMode] = useState<'CALENDAR' | 'CONFIG'>('CALENDAR');
  const [resFilterGroupSize, setResFilterGroupSize] = useState<number | 'ALL'>('ALL');

  // Connected Apps State
  const [selectedAppId, setSelectedAppId] = useState<string | null>('app_gloria');
  const [isEditingApp, setIsEditingApp] = useState(false);
  const [tempAppConfig, setTempAppConfig] = useState<ConnectedApp | null>(null);

  // Security & Deployment State
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState(false);
  const [kioskView, setKioskView] = useState<'HOME' | 'ORDER' | 'RESERVE'>('HOME');

  // Text Chat Bot State
  const [showTextChat, setShowTextChat] = useState(false);
  const [botChatHistory, setBotChatHistory] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [botChatMessage, setBotChatMessage] = useState('');
  const [isBotThinking, setIsBotThinking] = useState(false);
  const botChatEndRef = useRef<HTMLDivElement>(null);


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
    
    // New Fields defaults
    bookingPreference: 'GLORIA_FOODS',
    policies: {
      dietaryRestrictions: "We offer Gluten Free and Vegetarian options. Please ask specific allergen questions.",
      kidsZone: "We are family friendly and have high chairs available.",
      accessibility: "Our main entrance is wheelchair accessible.",
      largeParties: "Parties over 6 please call ahead."
    },
    editableSystemPrompt: "",
    
    // Reservation Configuration
    maxGroupSize: 10,
    maxGuestsPerHour: 50,
    tables: [
      { id: 't1', autoNumber: 1, name: 'Window Booth A', maxGuests: 4 },
      { id: 't2', autoNumber: 2, name: 'Window Booth B', maxGuests: 4 },
      { id: 't3', autoNumber: 3, name: 'Center Table 1', maxGuests: 2 },
      { id: 't4', autoNumber: 4, name: 'Center Table 2', maxGuests: 2 },
      { id: 't5', autoNumber: 5, name: 'Family Round', maxGuests: 8 },
    ],

    // Security
    adminPassword: "Admin",

    connectedApps: [
      {
        id: 'app_gloria',
        name: 'Gloria Foods',
        type: 'API',
        isDefault: true,
        config: {
          apiKey: 'gf_live_8823719283712',
          accountName: 'JoesBistro_GF',
          supportPhone: '+1 (888) 555-0123',
          supportEmail: 'support@gloriafood.com'
        }
      },
      {
        id: 'app_zapier',
        name: 'Zapier Automation',
        type: 'WEBHOOK',
        isDefault: false,
        config: {
          webhookIncoming: 'https://hooks.zapier.com/hooks/catch/123456/abcde',
          webhookOutgoing: 'https://api.menyo.com/v1/webhooks/zapier/out',
          supportEmail: 'automation-team@joesbistro.com'
        }
      }
    ]
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
  
  const handlePolicyChange = (key: keyof typeof profile.policies, value: string) => {
    setProfile(prev => ({
      ...prev,
      policies: { ...prev.policies, [key]: value }
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
      // Simulate scraped attributes
      policies: {
        ...prev.policies,
        accessibility: "Wheelchair accessible entrance, elevator, and restroom.",
        kidsZone: "Good for kids. High chairs and changing table in family restroom available.",
        dietaryRestrictions: "Vegetarian friendly. Gluten-free pasta available upon request.",
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
      bookingPreference: 'GLORIA_FOODS', // Default to Gloria if connected
      // Also update the connected app config for consistency
      connectedApps: prev.connectedApps.map(app => 
        app.id === 'app_gloria' ? { ...app, config: { ...app.config, apiKey: gloriaInput } } : app
      )
    }));
    setLoading(false);
  };

  const getTwilioNumber = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    setProfile(prev => ({
      ...prev,
      phoneNumber: "+1 (415) 555-0199",
      humanSupportPhone: "+1 (415) 555-0000", // Mock existing landline
      integrations: { ...prev.integrations, twilio: true }
    }));
    setLoading(false);
  };

  // --- Connected Apps Handlers ---

  const handleAppSelect = (app: ConnectedApp) => {
    setSelectedAppId(app.id);
    setIsEditingApp(false);
    setTempAppConfig(null);
  };

  const handleEditApp = () => {
    const app = profile.connectedApps.find(a => a.id === selectedAppId);
    if (app) {
      setTempAppConfig(JSON.parse(JSON.stringify(app))); // Deep copy
      setIsEditingApp(true);
    }
  };

  const handleSaveApp = () => {
    if (tempAppConfig) {
      setProfile(prev => ({
        ...prev,
        connectedApps: prev.connectedApps.map(app => 
          app.id === tempAppConfig.id ? tempAppConfig : app
        )
      }));
      setIsEditingApp(false);
      setTempAppConfig(null);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingApp(false);
    setTempAppConfig(null);
  };

  const handleTestConnection = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 1000));
    setLoading(false);
    alert("Connection Test Successful! ✅");
  };

  const handleAddApp = () => {
    const newApp: ConnectedApp = {
      id: `app_${Date.now()}`,
      name: 'New Connection',
      type: 'WEBHOOK',
      isDefault: false,
      config: {}
    };
    setProfile(prev => ({
      ...prev,
      connectedApps: [...prev.connectedApps, newApp]
    }));
    setSelectedAppId(newApp.id);
    setTempAppConfig(newApp);
    setIsEditingApp(true);
  };

  const handleSetDefault = (appId: string) => {
    setProfile(prev => ({
      ...prev,
      connectedApps: prev.connectedApps.map(app => ({
        ...app,
        isDefault: app.id === appId
      }))
    }));
  };

  // --- Chat Agent Handler ---
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || isChatProcessing) return;

    const userText = chatMessage;
    setChatMessage('');
    setChatHistory(prev => [...prev, { role: 'user', text: userText }]);
    setIsChatProcessing(true);

    try {
      const updates = await geminiService.updateProfileViaChat(profile, userText);
      
      // Apply updates to state
      setProfile(prev => {
        const newPolicies = { ...prev.policies, ...(updates.policies || {}) };
        const newInfo = { ...prev.info, ...(updates.info || {}) };
        return {
          ...prev,
          policies: newPolicies,
          info: newInfo
        };
      });

      // Simple response logic
      let responseText = "Updated!";
      const keys = [...Object.keys(updates.policies || {}), ...Object.keys(updates.info || {})];
      if (keys.length > 0) {
        responseText = `I've updated the ${keys.join(', ')} for you.`;
      } else {
        responseText = "I couldn't identify any specific settings to update from your message. Could you be more specific?";
      }

      setChatHistory(prev => [...prev, { role: 'assistant', text: responseText }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'assistant', text: "Sorry, I had trouble updating the settings." }]);
    } finally {
      setIsChatProcessing(false);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // --- Test Bot Text Chat Handler ---
  const handleBotChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botChatMessage.trim() || isBotThinking) return;

    const userText = botChatMessage;
    setBotChatMessage('');
    setBotChatHistory(prev => [...prev, { role: 'user', text: userText }]);
    setIsBotThinking(true);

    try {
      // Construct history for Gemini API
      const apiHistory = botChatHistory.map(msg => ({
         role: msg.role,
         parts: [{ text: msg.text }]
      }));

      const responseText = await geminiService.sendChatMessage(
         apiHistory, 
         profile.editableSystemPrompt,
         userText
      );

      setBotChatHistory(prev => [...prev, { role: 'model', text: responseText }]);

    } catch (err) {
       console.error(err);
       setBotChatHistory(prev => [...prev, { role: 'model', text: "Error connecting to bot." }]);
    } finally {
      setIsBotThinking(false);
    }
  };

  useEffect(() => {
    botChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [botChatHistory]);


  // --- Prompt Generation Logic ---
  const generateSystemPrompt = () => {
    const p = profile;
    
    let bookingInstructions = "";
    if (p.bookingPreference === 'GLORIA_FOODS' && p.integrations.gloriaFoods) {
      bookingInstructions = `- Use the 'gloria_reserve' tool to check availability and book tables for parties.
- If the party size is larger than 8, please politely ask them to call the restaurant directly at ${p.humanSupportPhone || p.info.phone}.`;
    } else if (p.bookingPreference === 'CUSTOM' && p.customBookingUrl) {
      bookingInstructions = `- Direct customers to book online at ${p.customBookingUrl}. Do not attempt to take the reservation yourself.`;
    } else {
      bookingInstructions = `- For all reservation requests, please transfer them to the human host or provide the phone number: ${p.humanSupportPhone || p.info.phone}.`;
    }

    const orderInstructions = p.integrations.gloriaFoods 
      ? `- You can place takeout orders using the 'gloria_order' tool. Confirm items against the menu.`
      : `- For takeout orders, please ask them to call ${p.humanSupportPhone || p.info.phone} or visit our website.`;

    const prompt = `You are an AI Voice Assistant for ${p.info.name}, a ${p.info.cuisine} restaurant located at ${p.info.address}.
Your voice should be friendly, professional, and efficient.

*** KNOWLEDGE BASE ***

[BUSINESS INFO]
Hours: ${p.info.hours}
Website: ${p.info.website}
Location: ${p.info.address}

[MENU & SPECIALS]
${p.menuContext || "No menu uploaded yet."}

[POLICIES & FACILITIES]
- Dietary: ${p.policies.dietaryRestrictions}
- Kids/Family: ${p.policies.kidsZone}
- Accessibility: ${p.policies.accessibility}
- Large Parties: ${p.policies.largeParties}

*** OPERATIONAL RULES ***

[RESERVATIONS]
${bookingInstructions}

[ORDERING]
${orderInstructions}

[GENERAL BEHAVIOR]
- Keep responses concise (under 2 sentences when possible) as this is a voice conversation.
- If you are unsure about a specific allergen not mentioned in the menu, apologize and suggest they speak to a manager.
- Always be polite and welcoming.
`;

    setProfile(prev => ({ ...prev, editableSystemPrompt: prompt }));
  };

  useEffect(() => {
    if (step === 4 || view === 'SETTINGS') {
      generateSystemPrompt();
    }
  }, [step, profile.integrations, profile.bookingPreference, profile.policies, profile.info, view]);


  const nextStep = () => {
    if (step === 6) {
      setView('DASHBOARD');
    } else {
      setStep(prev => prev + 1);
    }
  };

  // --- Deployed Logic ---
  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (unlockPassword === profile.adminPassword) {
      setView('DASHBOARD');
      setShowUnlockModal(false);
      setUnlockPassword('');
      setUnlockError(false);
      setKioskView('HOME'); // Reset kiosk view
    } else {
      setUnlockError(true);
    }
  };

  // --- Reservation Handlers ---
  const handleReservationClick = (res: Reservation) => {
    setSelectedReservation(res);
    setIsEditingReservation(true);
  };
  
  const handleUpdateReservation = () => {
    if (selectedReservation) {
      setReservations(prev => prev.map(r => r.id === selectedReservation.id ? selectedReservation : r));
      setIsEditingReservation(false);
      setSelectedReservation(null);
    }
  };
  
  const handleSendNotification = (type: 'SMS' | 'EMAIL') => {
    alert(`Simulated ${type} sent to ${selectedReservation?.customerName}`);
  };

  const handleTableToggle = (tableId: string) => {
    if (!selectedReservation) return;
    const currentIds = selectedReservation.tableIds || [];
    let newIds;
    if (currentIds.includes(tableId)) {
      newIds = currentIds.filter(id => id !== tableId);
    } else {
      newIds = [...currentIds, tableId];
    }
    setSelectedReservation({ ...selectedReservation, tableIds: newIds });
  };

  const handleAddTable = () => {
    const newTable: Table = {
      id: `t_${Date.now()}`,
      autoNumber: profile.tables.length + 1,
      name: `Table ${profile.tables.length + 1}`,
      maxGuests: 4
    };
    setProfile(p => ({ ...p, tables: [...p.tables, newTable] }));
  };

  const handleDeleteTable = (id: string) => {
    setProfile(p => ({ ...p, tables: p.tables.filter(t => t.id !== id) }));
  };


  // --- Render Steps (Wizard) ---
  // ... (Step 1-6 Functions Omitted for brevity but assumed present in final XML if I were outputting full file. 
  // IMPORTANT: Since I am outputting the WHOLE FILE, I must include everything.

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

  const renderStep4_KnowledgeBase = () => (
    <div className="space-y-8 h-full flex flex-col">
       <div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Knowledge Base Studio</h2>
        <p className="text-slate-500 text-lg">Define policies and review the exact instructions your Voice Bot will follow.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 flex-1">
        
        {/* Left Col: Structured Data */}
        <div className="space-y-6 overflow-y-auto pr-2">
          
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
             <div className="flex items-center gap-2 mb-4 text-brand-700 font-bold border-b border-brand-100 pb-2">
               <Settings className="w-5 h-5" /> Operational Policies
             </div>

             <div className="space-y-4">
                <div>
                   <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5 mb-2">
                     <UtensilsCrossed className="w-3.5 h-3.5" /> Dietary Restrictions
                   </label>
                   <textarea 
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                      rows={2}
                      value={profile.policies.dietaryRestrictions}
                      onChange={(e) => handlePolicyChange('dietaryRestrictions', e.target.value)}
                   />
                </div>
                <div>
                   <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5 mb-2">
                     <Baby className="w-3.5 h-3.5" /> Kids & Family
                   </label>
                   <textarea 
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                      rows={2}
                      value={profile.policies.kidsZone}
                      onChange={(e) => handlePolicyChange('kidsZone', e.target.value)}
                   />
                </div>
                <div>
                   <label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5 mb-2">
                     <Accessibility className="w-3.5 h-3.5" /> Accessibility
                   </label>
                   <textarea 
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                      rows={2}
                      value={profile.policies.accessibility}
                      onChange={(e) => handlePolicyChange('accessibility', e.target.value)}
                   />
                </div>
             </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
             <div className="flex items-center gap-2 mb-4 text-orange-700 font-bold border-b border-orange-100 pb-2">
               <Users className="w-5 h-5" /> Booking Logic
             </div>
             
             <div className="space-y-4">
                <div>
                   <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Reservation Handling</label>
                   <select 
                    value={profile.bookingPreference}
                    onChange={(e) => setProfile(p => ({...p, bookingPreference: e.target.value as any}))}
                    className="w-full p-3 border border-slate-200 rounded-lg bg-white font-medium"
                   >
                     <option value="GLORIA_FOODS" disabled={!profile.integrations.gloriaFoods}>Use Gloria Foods API {profile.integrations.gloriaFoods ? '(Connected)' : '(Not Connected)'}</option>
                     <option value="HUMAN_SUPPORT">Route to Human Phone</option>
                     <option value="CUSTOM">Custom Booking URL</option>
                   </select>
                </div>
                
                {profile.bookingPreference === 'HUMAN_SUPPORT' && (
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Support Phone Number</label>
                    <input 
                      type="text" 
                      value={profile.humanSupportPhone || ''}
                      onChange={(e) => setProfile(p => ({...p, humanSupportPhone: e.target.value}))}
                      className="w-full p-3 border border-slate-200 rounded-lg bg-slate-50"
                      placeholder="+1 (555) ..."
                    />
                  </div>
                )}
                
                 <div>
                   <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Large Party Policy</label>
                   <input 
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 outline-none"
                      value={profile.policies.largeParties}
                      onChange={(e) => handlePolicyChange('largeParties', e.target.value)}
                   />
                </div>
             </div>
          </div>
        
        </div>

        {/* Right Col: Raw Prompt Editor */}
        <div className="flex flex-col h-full bg-slate-900 rounded-2xl overflow-hidden shadow-2xl ring-4 ring-slate-100">
           <div className="bg-slate-800 p-4 flex justify-between items-center border-b border-slate-700">
             <div className="flex items-center gap-2 text-slate-200 font-mono text-sm">
                <BookOpen className="w-4 h-4" /> System_Instruction.txt
             </div>
             <div className="flex gap-2">
                <button 
                  onClick={generateSystemPrompt} 
                  className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded transition"
                >
                  Regenerate from Data
                </button>
             </div>
           </div>
           <div className="flex-1 relative group">
             <textarea 
                className="w-full h-full bg-slate-900 text-slate-300 font-mono text-sm p-6 resize-none outline-none leading-relaxed"
                value={profile.editableSystemPrompt}
                onChange={(e) => setProfile(p => ({...p, editableSystemPrompt: e.target.value}))}
             />
             <div className="absolute bottom-4 right-4 bg-blue-600/20 text-blue-400 px-3 py-1 rounded-full text-xs font-mono border border-blue-500/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
               LIVE EDIT MODE
             </div>
           </div>
        </div>

      </div>

      <div className="flex justify-between items-center pt-6 border-t border-slate-100">
         <button onClick={() => setStep(3)} className="text-slate-400 hover:text-slate-600 font-medium px-4 py-2">Back</button>
         <button 
          onClick={nextStep}
          className="bg-brand-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-brand-700 shadow-lg shadow-brand-500/20"
        >
          Confirm Knowledge Base
        </button>
      </div>
    </div>
  );

  const renderStep5_Phone = () => (
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
         <button onClick={() => setStep(4)} className="text-slate-400 hover:text-slate-600 font-medium px-4 py-2">Back</button>
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

  const renderStep6_Voice = () => (
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

      <div className="flex justify-between items-center pt-6 border-t border-slate-100">
         <button onClick={() => setStep(5)} className="text-slate-400 hover:text-slate-600 font-medium px-4 py-2">Back</button>
         <button 
          onClick={nextStep}
          className="bg-brand-600 text-white px-8 py-4 rounded-xl font-bold hover:bg-brand-700 shadow-xl shadow-brand-500/30 transform transition hover:-translate-y-1"
        >
          Launch Voice Bot 🚀
        </button>
      </div>
    </div>
  );

  // --- Settings View Components ---

  const renderConnectedApps = () => {
    // Sort apps: Default first, then others
    const sortedApps = [...profile.connectedApps].sort((a, b) => 
      (a.isDefault === b.isDefault) ? 0 : a.isDefault ? -1 : 1
    );

    const activeApp = profile.connectedApps.find(a => a.id === selectedAppId);
    // Use temp config if editing, otherwise active app config
    const displayConfig = isEditingApp && tempAppConfig ? tempAppConfig : activeApp;

    return (
      <div className="flex h-full">
         {/* Left List */}
         <div className="w-72 border-r border-slate-200 bg-slate-50 p-4 flex flex-col">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2">Integrations</h3>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {sortedApps.map(app => (
                <button
                  key={app.id}
                  onClick={() => handleAppSelect(app)}
                  className={`w-full text-left p-3 rounded-xl border transition-all relative ${selectedAppId === app.id ? 'bg-white border-brand-200 shadow-sm ring-1 ring-brand-100' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${app.type === 'WEBHOOK' ? 'bg-purple-100 text-purple-600' : 'bg-orange-100 text-orange-600'}`}>
                       {app.type === 'WEBHOOK' ? <Globe className="w-5 h-5" /> : <Server className="w-5 h-5" />}
                    </div>
                    <div>
                       <p className={`font-bold text-sm ${selectedAppId === app.id ? 'text-brand-900' : 'text-slate-700'}`}>{app.name}</p>
                       <p className="text-xs text-slate-400">{app.type}</p>
                    </div>
                  </div>
                  {app.isDefault && (
                    <div className="absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full"></div>
                  )}
                </button>
              ))}
            </div>
            <button 
              onClick={handleAddApp}
              className="mt-4 w-full py-3 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center gap-2 text-slate-500 font-medium hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50 transition"
            >
              <Plus className="w-4 h-4" /> Add Connection
            </button>
         </div>

         {/* Right Details */}
         <div className="flex-1 bg-white p-8 overflow-y-auto">
            {displayConfig ? (
               <div className="max-w-2xl mx-auto">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-100">
                     <div className="flex items-center gap-4">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm ${displayConfig.type === 'WEBHOOK' ? 'bg-purple-600 text-white' : 'bg-orange-600 text-white'}`}>
                           {displayConfig.type === 'WEBHOOK' ? <Globe className="w-7 h-7" /> : <Server className="w-7 h-7" />}
                        </div>
                        <div>
                           {isEditingApp ? (
                              <input 
                                type="text" 
                                value={displayConfig.name}
                                onChange={(e) => setTempAppConfig(prev => prev ? {...prev, name: e.target.value} : null)}
                                className="font-bold text-2xl text-slate-900 border-b border-slate-300 focus:border-brand-500 focus:outline-none bg-transparent"
                              />
                           ) : (
                              <h2 className="font-bold text-2xl text-slate-900 flex items-center gap-2">
                                 {displayConfig.name}
                                 {displayConfig.isDefault && <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full border border-green-200">Default App</span>}
                              </h2>
                           )}
                           <p className="text-slate-500 text-sm">{displayConfig.id}</p>
                        </div>
                     </div>
                     {!isEditingApp && (
                       <div className="flex gap-2">
                          <button 
                            onClick={handleEditApp}
                            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-700 font-medium shadow-sm hover:bg-slate-50 transition"
                          >
                             Edit Settings
                          </button>
                          {!displayConfig.isDefault && (
                             <button 
                               onClick={() => handleSetDefault(displayConfig.id)}
                               className="px-4 py-2 bg-brand-50 text-brand-700 rounded-lg font-medium hover:bg-brand-100 transition"
                             >
                               Make Default
                             </button>
                          )}
                       </div>
                     )}
                  </div>

                  {/* Settings Form */}
                  <div className="space-y-6">
                     {/* Form Logic Same as previous response, omitted for brevity but included in output */}
                     {/* Webhooks Section */}
                     <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                        <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                           <Plug className="w-4 h-4" /> Endpoint Configuration
                        </h4>
                        <div className="space-y-4">
                           {/* API Key */}
                           {displayConfig.type === 'API' && (
                             <div>
                                <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">API Key</label>
                                {isEditingApp ? (
                                   <input 
                                     type="text" 
                                     value={displayConfig.config.apiKey || ''}
                                     onChange={(e) => setTempAppConfig(prev => prev ? {...prev, config: {...prev.config, apiKey: e.target.value}} : null)}
                                     className="w-full p-3 border border-slate-200 rounded-lg"
                                   />
                                ) : (
                                   <div className="font-mono text-sm bg-white border border-slate-200 rounded p-2 text-slate-600 truncate">
                                      {displayConfig.config.apiKey ? '••••••••••••••••' : 'Not Configured'}
                                   </div>
                                )}
                             </div>
                           )}

                           {/* Incoming Webhook */}
                           {displayConfig.type === 'WEBHOOK' && (
                             <div>
                                <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Incoming Webhook (Trigger)</label>
                                {isEditingApp ? (
                                   <input 
                                     type="text" 
                                     value={displayConfig.config.webhookIncoming || ''}
                                     onChange={(e) => setTempAppConfig(prev => prev ? {...prev, config: {...prev.config, webhookIncoming: e.target.value}} : null)}
                                     className="w-full p-3 border border-slate-200 rounded-lg font-mono text-sm"
                                   />
                                ) : (
                                   <div className="flex items-center gap-2 text-sm text-slate-600 bg-white p-2 rounded border border-slate-200">
                                      <span className="truncate flex-1 font-mono">{displayConfig.config.webhookIncoming || 'Not configured'}</span>
                                      <ExternalLink className="w-3 h-3 text-slate-400" />
                                   </div>
                                )}
                             </div>
                           )}

                            {/* Outgoing Webhook */}
                           <div>
                              <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Outgoing Webhook (Events)</label>
                              {isEditingApp ? (
                                 <input 
                                   type="text" 
                                   value={displayConfig.config.webhookOutgoing || ''}
                                   onChange={(e) => setTempAppConfig(prev => prev ? {...prev, config: {...prev.config, webhookOutgoing: e.target.value}} : null)}
                                   className="w-full p-3 border border-slate-200 rounded-lg font-mono text-sm"
                                 />
                              ) : (
                                 <div className="flex items-center gap-2 text-sm text-slate-600 bg-white p-2 rounded border border-slate-200">
                                    <span className="truncate flex-1 font-mono">{displayConfig.config.webhookOutgoing || 'Not configured'}</span>
                                    <ExternalLink className="w-3 h-3 text-slate-400" />
                                 </div>
                              )}
                           </div>
                        </div>
                     </div>

                     {/* Credentials Section */}
                     <div className="grid grid-cols-2 gap-6">
                        <div>
                           <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Account Name</label>
                           {isEditingApp ? (
                              <input 
                                type="text" 
                                value={displayConfig.config.accountName || ''}
                                onChange={(e) => setTempAppConfig(prev => prev ? {...prev, config: {...prev.config, accountName: e.target.value}} : null)}
                                className="w-full p-3 border border-slate-200 rounded-lg"
                              />
                           ) : (
                              <div className="p-3 bg-slate-50 rounded-lg text-slate-700 font-medium">
                                 {displayConfig.config.accountName || '—'}
                              </div>
                           )}
                        </div>
                        <div>
                           <label className="text-xs font-semibold text-slate-500 uppercase mb-1.5 block">Password / Secret</label>
                           {isEditingApp ? (
                              <input 
                                type="password" 
                                value={displayConfig.config.accountPassword || ''}
                                onChange={(e) => setTempAppConfig(prev => prev ? {...prev, config: {...prev.config, accountPassword: e.target.value}} : null)}
                                className="w-full p-3 border border-slate-200 rounded-lg"
                                placeholder="••••••"
                              />
                           ) : (
                              <div className="p-3 bg-slate-50 rounded-lg text-slate-400">
                                 {displayConfig.config.accountPassword ? '••••••' : '—'}
                              </div>
                           )}
                        </div>
                     </div>

                     {/* Support Info */}
                     <div className="bg-brand-50/50 rounded-xl p-6 border border-brand-100">
                        <h4 className="font-bold text-brand-800 mb-4 flex items-center gap-2">
                           <Users className="w-4 h-4" /> Customer Support Routing
                        </h4>
                        <div className="grid grid-cols-2 gap-6">
                           <div>
                              <label className="text-xs font-semibold text-brand-600/70 uppercase mb-1.5 block">Support Phone</label>
                              {isEditingApp ? (
                                 <input 
                                   type="text" 
                                   value={displayConfig.config.supportPhone || ''}
                                   onChange={(e) => setTempAppConfig(prev => prev ? {...prev, config: {...prev.config, supportPhone: e.target.value}} : null)}
                                   className="w-full p-3 border border-brand-200 rounded-lg"
                                   placeholder="+1 ..."
                                 />
                              ) : displayConfig.config.supportPhone ? (
                                 <a 
                                   href={`tel:${displayConfig.config.supportPhone}`} 
                                   className="flex items-center gap-2 p-3 bg-white border border-brand-200 rounded-lg text-brand-600 font-bold hover:bg-brand-50 transition"
                                 >
                                    <Phone className="w-4 h-4" /> {displayConfig.config.supportPhone}
                                 </a>
                              ) : (
                                 <div className="p-3 text-slate-400 text-sm">Not Configured</div>
                              )}
                           </div>
                           <div>
                              <label className="text-xs font-semibold text-brand-600/70 uppercase mb-1.5 block">Support Email</label>
                              {isEditingApp ? (
                                 <input 
                                   type="text" 
                                   value={displayConfig.config.supportEmail || ''}
                                   onChange={(e) => setTempAppConfig(prev => prev ? {...prev, config: {...prev.config, supportEmail: e.target.value}} : null)}
                                   className="w-full p-3 border border-brand-200 rounded-lg"
                                   placeholder="help@..."
                                 />
                              ) : displayConfig.config.supportEmail ? (
                                 <a 
                                   href={`mailto:${displayConfig.config.supportEmail}`} 
                                   className="flex items-center gap-2 p-3 bg-white border border-brand-200 rounded-lg text-brand-600 font-bold hover:bg-brand-50 transition"
                                 >
                                    <Mail className="w-4 h-4" /> {displayConfig.config.supportEmail}
                                 </a>
                              ) : (
                                 <div className="p-3 text-slate-400 text-sm">Not Configured</div>
                              )}
                           </div>
                        </div>
                     </div>

                     {/* Action Buttons (Edit Mode) */}
                     {isEditingApp && (
                        <div className="flex items-center justify-between pt-6 border-t border-slate-100 mt-6">
                           <button 
                             onClick={handleTestConnection}
                             disabled={loading}
                             className="text-brand-600 font-bold hover:underline flex items-center gap-2"
                           >
                             {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test Connection'}
                           </button>
                           <div className="flex gap-3">
                              <button 
                                onClick={handleCancelEdit}
                                className="px-6 py-2 rounded-lg text-slate-600 font-medium hover:bg-slate-100"
                              >
                                Cancel
                              </button>
                              <button 
                                onClick={handleSaveApp}
                                className="px-6 py-2 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800 shadow-lg shadow-slate-900/20"
                              >
                                Save Changes
                              </button>
                           </div>
                        </div>
                     )}
                  </div>
               </div>
            ) : (
               <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <Plug className="w-16 h-16 mb-4 text-slate-200" />
                  <p>Select an App to configure</p>
               </div>
            )}
         </div>
      </div>
    );
  };

  const renderReservationsSettings = () => {
    // Group reservations by column (Mock logic)
    const weekColumns = Array.from({ length: 7 }, (_, i) => i);
    const today = new Date();

    const filteredReservations = reservations.filter(res => 
      resFilterGroupSize === 'ALL' || res.partySize === resFilterGroupSize
    );
    
    return (
      <div className="flex h-full flex-col">
         {/* Toggle Config/Calendar Header */}
         <div className="bg-white border-b border-slate-200 p-4 flex items-center justify-between shadow-sm z-10">
            <div className="flex bg-slate-100 rounded-lg p-1">
               <button 
                  onClick={() => setResViewMode('CALENDAR')}
                  className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${resViewMode === 'CALENDAR' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
               >
                  Calendar View
               </button>
               <button 
                  onClick={() => setResViewMode('CONFIG')}
                  className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${resViewMode === 'CONFIG' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
               >
                  ⚙️ Configure Rules & Tables
               </button>
            </div>
            
            {/* Contextual Toolbar */}
            {resViewMode === 'CALENDAR' ? (
               <div className="flex gap-4 items-center">
                  <div className="flex items-center gap-2">
                     <span className="text-xs font-bold text-slate-400 uppercase">Filter Guests:</span>
                     <select 
                        className="bg-slate-50 border border-slate-200 rounded-lg text-sm p-2 font-medium"
                        value={resFilterGroupSize}
                        onChange={(e) => setResFilterGroupSize(e.target.value === 'ALL' ? 'ALL' : parseInt(e.target.value))}
                     >
                        <option value="ALL">All Sizes</option>
                        {Array.from({length: profile.maxGroupSize}, (_, i) => i + 1).map(n => (
                           <option key={n} value={n}>{n} Guests</option>
                        ))}
                     </select>
                  </div>
                  <div className="h-6 w-px bg-slate-200 mx-2"></div>
                  <button className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg flex items-center gap-2 hover:bg-slate-50">
                     <img src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg" className="w-4 h-4" alt="Google" />
                     Sync
                  </button>
               </div>
            ) : (
               <button className="px-4 py-2 bg-slate-900 text-white text-sm font-bold rounded-lg shadow hover:bg-slate-800">
                  Save Configuration
               </button>
            )}
         </div>

         {/* Content Area */}
         {resViewMode === 'CALENDAR' ? (
           <div className="flex-1 flex overflow-hidden">
               {/* Left List: Upcoming */}
               <div className="w-72 border-r border-slate-200 bg-slate-50 p-4 flex flex-col">
                 <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2">Upcoming Reservations</h3>
                 <div className="flex-1 space-y-2 overflow-y-auto">
                   {filteredReservations.sort((a,b) => a.time.localeCompare(b.time)).map(res => (
                     <button
                       key={res.id}
                       onClick={() => handleReservationClick(res)}
                       className={`w-full bg-white p-3 rounded-xl border hover:shadow-sm text-left transition relative overflow-hidden ${res.hasConflict ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-100 hover:border-brand-300'}`}
                     >
                       <div className="flex justify-between items-start mb-1">
                         <span className="font-bold text-slate-800">{res.customerName}</span>
                         <span className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{res.time}</span>
                       </div>
                       <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                         <Users className="w-3 h-3" /> {res.partySize} guests
                       </div>
                       
                       {/* Table Pills */}
                       {res.tableIds && res.tableIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                             {res.tableIds.map(tid => {
                                const table = profile.tables.find(t => t.id === tid);
                                return table ? (
                                   <span key={tid} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 rounded border border-slate-200">
                                      {table.name}
                                   </span>
                                ) : null;
                             })}
                          </div>
                       )}

                       <div className={`text-[10px] uppercase font-bold ${res.status === 'CONFIRMED' ? 'text-green-600' : res.status === 'PENDING' ? 'text-orange-500' : 'text-red-500'}`}>
                         {res.status}
                       </div>

                       {res.hasConflict && (
                          <div className="absolute top-0 right-0 p-1 bg-red-500 text-white rounded-bl-lg">
                             <AlertTriangle className="w-3 h-3" />
                          </div>
                       )}
                     </button>
                   ))}
                 </div>
               </div>
               
               {/* Right: Calendar View */}
               <div className="flex-1 flex flex-col bg-white">
                  {/* Calendar Grid */}
                  <div className="flex-1 p-4 overflow-y-auto">
                     <div className="grid grid-cols-7 gap-4 h-full min-h-[500px]">
                        {weekColumns.map(colIndex => (
                           <div key={colIndex} className="bg-slate-50 rounded-lg p-2 min-h-full border border-slate-100">
                              <div className="text-center mb-4 pb-2 border-b border-slate-200">
                                 <span className="text-xs font-bold text-slate-400 block uppercase">
                                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][colIndex]}
                                 </span>
                                 <span className="text-sm font-bold text-slate-900">
                                    {today.getDate() + colIndex}
                                 </span>
                              </div>
                              {/* Mock mapping: Just random placement for demo */}
                              {filteredReservations.filter((_, i) => i % 7 === colIndex).map(res => (
                                 <div 
                                    key={res.id} 
                                    onClick={() => handleReservationClick(res)}
                                    className={`p-2 rounded border shadow-sm text-xs mb-2 cursor-pointer hover:ring-2 hover:ring-brand-200 relative ${res.hasConflict ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}
                                 >
                                    <div className="font-bold text-slate-700">{res.time}</div>
                                    <div className="truncate">{res.customerName}</div>
                                    {res.hasConflict && <AlertTriangle className="w-3 h-3 text-red-500 absolute top-1 right-1" />}
                                 </div>
                              ))}
                           </div>
                        ))}
                     </div>
                  </div>
               </div>
           </div>
         ) : (
           <div className="flex-1 p-8 overflow-y-auto bg-slate-50">
              <div className="max-w-4xl mx-auto space-y-8">
                 
                 {/* Capacity Settings */}
                 <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                       <Users className="w-5 h-5 text-brand-600" /> Dining Room Capacity Rules
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                       <div>
                          <label className="text-sm font-bold text-slate-700 block mb-2">Max Group Size (Auto-Book)</label>
                          <p className="text-xs text-slate-500 mb-3">Groups larger than this will be routed to phone support.</p>
                          <input 
                             type="number" 
                             value={profile.maxGroupSize}
                             onChange={(e) => setProfile(p => ({...p, maxGroupSize: parseInt(e.target.value)}))}
                             className="w-full p-3 border border-slate-200 rounded-lg font-mono text-lg"
                          />
                       </div>
                       <div>
                          <label className="text-sm font-bold text-slate-700 block mb-2">Max Guests Per Hour</label>
                          <p className="text-xs text-slate-500 mb-3">Limits total covers per hour slot to prevent kitchen overload.</p>
                          <input 
                             type="number" 
                             value={profile.maxGuestsPerHour}
                             onChange={(e) => setProfile(p => ({...p, maxGuestsPerHour: parseInt(e.target.value)}))}
                             className="w-full p-3 border border-slate-200 rounded-lg font-mono text-lg"
                          />
                       </div>
                    </div>
                 </div>

                 {/* Table Matrix */}
                 <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex justify-between items-center mb-6">
                       <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                          <LayoutGrid className="w-5 h-5 text-brand-600" /> Table Inventory
                       </h3>
                       <button 
                          onClick={handleAddTable}
                          className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-lg text-sm font-bold hover:bg-brand-100 transition flex items-center gap-2"
                       >
                          <Plus className="w-4 h-4" /> Add Table
                       </button>
                    </div>
                    
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                       <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider">
                             <tr>
                                <th className="p-4 w-16 text-center">#</th>
                                <th className="p-4">Table Name</th>
                                <th className="p-4 w-32">Capacity</th>
                                <th className="p-4 w-20 text-center">Actions</th>
                             </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                             {profile.tables.map((table, index) => (
                                <tr key={table.id} className="hover:bg-slate-50/50">
                                   <td className="p-4 text-center font-mono text-slate-400">{table.autoNumber}</td>
                                   <td className="p-4">
                                      <input 
                                         value={table.name}
                                         onChange={(e) => setProfile(p => ({
                                            ...p, tables: p.tables.map(t => t.id === table.id ? {...t, name: e.target.value} : t)
                                         }))}
                                         className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-brand-500 outline-none font-medium text-slate-900"
                                      />
                                   </td>
                                   <td className="p-4">
                                      <div className="flex items-center gap-2">
                                         <Users className="w-3 h-3 text-slate-400" />
                                         <input 
                                            type="number"
                                            value={table.maxGuests}
                                            onChange={(e) => setProfile(p => ({
                                               ...p, tables: p.tables.map(t => t.id === table.id ? {...t, maxGuests: parseInt(e.target.value)} : t)
                                            }))}
                                            className="w-16 bg-slate-100 rounded px-2 py-1 text-center font-medium outline-none focus:ring-2 focus:ring-brand-500"
                                         />
                                      </div>
                                   </td>
                                   <td className="p-4 text-center">
                                      <button 
                                         onClick={() => handleDeleteTable(table.id)}
                                         className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                                      >
                                         <Trash2 className="w-4 h-4" />
                                      </button>
                                   </td>
                                </tr>
                             ))}
                             {profile.tables.length === 0 && (
                                <tr>
                                   <td colSpan={4} className="p-8 text-center text-slate-400">
                                      No tables configured yet. Add one to start.
                                   </td>
                                </tr>
                             )}
                          </tbody>
                       </table>
                    </div>
                 </div>

              </div>
           </div>
         )}

         {/* Edit Modal (Overlay) */}
         {isEditingReservation && selectedReservation && (
            <div className="absolute inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4">
               <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                  <div className="flex justify-between items-center mb-6">
                     <h3 className="text-lg font-bold">Edit Reservation</h3>
                     <button onClick={() => setIsEditingReservation(false)}><X className="w-5 h-5 text-slate-400" /></button>
                  </div>
                  <div className="space-y-4 overflow-y-auto flex-1 pr-2">
                     
                     {/* Conflict Alert Banner in Modal */}
                     {selectedReservation.hasConflict && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-3">
                           <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                           <div>
                              <h4 className="text-sm font-bold text-red-800">Booking Conflict Detected</h4>
                              <p className="text-xs text-red-600">{selectedReservation.notes || "This reservation exceeds capacity rules."}</p>
                           </div>
                        </div>
                     )}

                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="text-xs font-bold text-slate-500 uppercase">Date</label>
                           <input 
                              type="date" 
                              value={selectedReservation.date}
                              onChange={(e) => setSelectedReservation({...selectedReservation, date: e.target.value})}
                              className="w-full p-2 border border-slate-200 rounded mt-1"
                           />
                        </div>
                        <div>
                           <label className="text-xs font-bold text-slate-500 uppercase">Time</label>
                           <input 
                              type="time" 
                              value={selectedReservation.time}
                              onChange={(e) => setSelectedReservation({...selectedReservation, time: e.target.value})}
                              className="w-full p-2 border border-slate-200 rounded mt-1"
                           />
                        </div>
                     </div>
                     <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Customer Name</label>
                        <input 
                           value={selectedReservation.customerName}
                           onChange={(e) => setSelectedReservation({...selectedReservation, customerName: e.target.value})}
                           className="w-full p-2 border border-slate-200 rounded mt-1"
                        />
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="text-xs font-bold text-slate-500 uppercase">Party Size</label>
                           <input 
                              type="number"
                              value={selectedReservation.partySize}
                              onChange={(e) => setSelectedReservation({...selectedReservation, partySize: parseInt(e.target.value)})}
                              className="w-full p-2 border border-slate-200 rounded mt-1"
                           />
                        </div>
                        <div>
                           <label className="text-xs font-bold text-slate-500 uppercase">Status</label>
                           <select 
                              value={selectedReservation.status}
                              onChange={(e) => setSelectedReservation({...selectedReservation, status: e.target.value as any})}
                              className="w-full p-2 border border-slate-200 rounded mt-1"
                           >
                              <option value="CONFIRMED">Confirmed</option>
                              <option value="PENDING">Pending</option>
                              <option value="CANCELLED">Cancelled</option>
                           </select>
                        </div>
                     </div>
                     
                     {/* Table Assignment Section */}
                     <div className="pt-2 border-t border-slate-100">
                        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Table Assignment</label>
                        <div className="grid grid-cols-2 gap-2">
                           {profile.tables.map(table => {
                              const isSelected = selectedReservation.tableIds?.includes(table.id);
                              return (
                                 <button
                                    key={table.id}
                                    onClick={() => handleTableToggle(table.id)}
                                    className={`p-2 rounded border text-left text-xs transition-all ${isSelected ? 'bg-brand-50 border-brand-500 ring-1 ring-brand-500' : 'bg-white border-slate-200 hover:border-slate-300'}`}
                                 >
                                    <div className="font-bold text-slate-800">{table.name}</div>
                                    <div className="text-slate-500">Cap: {table.maxGuests}</div>
                                 </button>
                              );
                           })}
                        </div>
                     </div>

                     <div>
                        <label className="text-xs font-bold text-slate-500 uppercase">Notes</label>
                        <textarea 
                           value={selectedReservation.notes || ''}
                           onChange={(e) => setSelectedReservation({...selectedReservation, notes: e.target.value})}
                           className="w-full p-2 border border-slate-200 rounded mt-1 h-20"
                        />
                     </div>
                  </div>
                  <div className="flex gap-2 mt-6 pt-6 border-t border-slate-100">
                     <button 
                        onClick={() => handleSendNotification('SMS')}
                        className="flex-1 py-2 border border-slate-200 rounded-lg text-slate-600 text-sm font-medium hover:bg-slate-50"
                     >
                        Send SMS
                     </button>
                     <button 
                        onClick={() => handleSendNotification('EMAIL')}
                        className="flex-1 py-2 border border-slate-200 rounded-lg text-slate-600 text-sm font-medium hover:bg-slate-50"
                     >
                        Send Email
                     </button>
                  </div>
                  <button 
                     onClick={handleUpdateReservation}
                     className="w-full mt-4 bg-brand-600 text-white py-3 rounded-lg font-bold hover:bg-brand-700"
                  >
                     Save Changes
                  </button>
               </div>
            </div>
         )}
      </div>
    );
  };
// ... (Render Settings, Deployed, and Main Render remain the same as previous logical block)

  const renderSettings = () => (
    <div className="max-w-7xl mx-auto py-8 px-6 h-full flex flex-col">
       <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Settings & Configuration</h1>
            <p className="text-slate-500">Manage your agent's behavior, voice, and connection.</p>
          </div>
          <button onClick={() => setView('DASHBOARD')} className="p-2 hover:bg-slate-100 rounded-full">
            <X className="w-6 h-6 text-slate-500" />
          </button>
       </div>

       <div className="flex flex-1 gap-8 overflow-hidden">
          {/* Settings Sidebar */}
          <div className="w-64 flex-shrink-0 space-y-2">
            <button 
              onClick={() => setSettingsTab('KNOWLEDGE')}
              className={`w-full text-left p-4 rounded-xl font-medium transition-colors flex items-center gap-3 ${settingsTab === 'KNOWLEDGE' ? 'bg-white shadow-sm text-brand-700 ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/50'}`}
            >
              <BookOpen className="w-5 h-5" /> Knowledge Base
            </button>
            <button 
              onClick={() => setSettingsTab('RESERVATIONS')}
              className={`w-full text-left p-4 rounded-xl font-medium transition-colors flex items-center gap-3 ${settingsTab === 'RESERVATIONS' ? 'bg-white shadow-sm text-brand-700 ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/50'}`}
            >
              <Calendar className="w-5 h-5" /> Reservations
            </button>
            <button 
              onClick={() => setSettingsTab('VOICE')}
              className={`w-full text-left p-4 rounded-xl font-medium transition-colors flex items-center gap-3 ${settingsTab === 'VOICE' ? 'bg-white shadow-sm text-brand-700 ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/50'}`}
            >
              <Mic className="w-5 h-5" /> Voice & Personality
            </button>
            <button 
              onClick={() => setSettingsTab('PHONE')}
              className={`w-full text-left p-4 rounded-xl font-medium transition-colors flex items-center gap-3 ${settingsTab === 'PHONE' ? 'bg-white shadow-sm text-brand-700 ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/50'}`}
            >
              <Phone className="w-5 h-5" /> Phone Number
            </button>
            <button 
              onClick={() => setSettingsTab('APPS')}
              className={`w-full text-left p-4 rounded-xl font-medium transition-colors flex items-center gap-3 ${settingsTab === 'APPS' ? 'bg-white shadow-sm text-brand-700 ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/50'}`}
            >
              <Plug className="w-5 h-5" /> Connected Apps
            </button>
            <button 
              onClick={() => setSettingsTab('SECURITY')}
              className={`w-full text-left p-4 rounded-xl font-medium transition-colors flex items-center gap-3 ${settingsTab === 'SECURITY' ? 'bg-white shadow-sm text-brand-700 ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/50'}`}
            >
              <ShieldCheck className="w-5 h-5" /> Security
            </button>
          </div>

          {/* Settings Content */}
          <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
             
             {settingsTab === 'KNOWLEDGE' && (
               <div className="flex h-full">
                  {/* Standard Form Area */}
                  <div className="flex-1 p-8 overflow-y-auto border-r border-slate-100">
                    <h3 className="text-xl font-bold text-slate-900 mb-6">Policies & Booking</h3>
                    <div className="space-y-6">
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Dietary Restrictions</label>
                        <textarea 
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                            rows={3}
                            value={profile.policies.dietaryRestrictions}
                            onChange={(e) => handlePolicyChange('dietaryRestrictions', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Kids Policy</label>
                        <textarea 
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                            rows={3}
                            value={profile.policies.kidsZone}
                            onChange={(e) => handlePolicyChange('kidsZone', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Accessibility</label>
                        <textarea 
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                            rows={3}
                            value={profile.policies.accessibility}
                            onChange={(e) => handlePolicyChange('accessibility', e.target.value)}
                        />
                      </div>
                      <div>
                         <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Booking Logic</label>
                         <select 
                          value={profile.bookingPreference}
                          onChange={(e) => setProfile(p => ({...p, bookingPreference: e.target.value as any}))}
                          className="w-full p-3 border border-slate-200 rounded-lg bg-white font-medium mb-2"
                         >
                           <option value="GLORIA_FOODS">Use Gloria Foods API</option>
                           <option value="HUMAN_SUPPORT">Route to Human Phone</option>
                           <option value="CUSTOM">Custom Booking URL</option>
                         </select>
                      </div>
                    </div>
                  </div>

                  {/* Chat Assistant */}
                  <div className="w-96 bg-slate-50 flex flex-col border-l border-slate-200">
                     <div className="p-4 bg-white border-b border-slate-200 flex items-center gap-2">
                        <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center">
                           <Bot className="w-5 h-5 text-brand-600" />
                        </div>
                        <div>
                           <p className="text-sm font-bold text-slate-900">Config Assistant</p>
                           <p className="text-xs text-brand-600">AI Powered</p>
                        </div>
                     </div>
                     
                     <div className="flex-1 p-4 overflow-y-auto space-y-4">
                        {chatHistory.map((msg, idx) => (
                           <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-brand-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'}`}>
                                 {msg.text}
                              </div>
                           </div>
                        ))}
                        {isChatProcessing && (
                           <div className="flex justify-start">
                             <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none">
                                <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                             </div>
                           </div>
                        )}
                        <div ref={chatEndRef} />
                     </div>

                     <form onSubmit={handleChatSubmit} className="p-3 bg-white border-t border-slate-200">
                        <div className="relative">
                           <input 
                              type="text" 
                              placeholder="Type a change (e.g., 'We are closed Mondays')" 
                              className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                              value={chatMessage}
                              onChange={(e) => setChatMessage(e.target.value)}
                           />
                           <button 
                             type="submit" 
                             disabled={!chatMessage.trim() || isChatProcessing}
                             className="absolute right-2 top-2 p-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition"
                           >
                              <Send className="w-4 h-4" />
                           </button>
                        </div>
                     </form>
                  </div>
               </div>
             )}

             {settingsTab === 'RESERVATIONS' && renderReservationsSettings()}

             {settingsTab === 'VOICE' && (
                <div className="p-8 overflow-y-auto">
                   <h3 className="text-xl font-bold text-slate-900 mb-6">Select Voice Personality</h3>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Object.values(VoiceOption).map((voice) => (
                        <div 
                          key={voice}
                          onClick={() => setProfile(p => ({...p, voiceId: voice}))}
                          className={`p-5 rounded-2xl border-2 cursor-pointer transition-all ${profile.voiceId === voice ? 'border-brand-500 bg-brand-50/50' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${profile.voiceId === voice ? 'bg-brand-200 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                              <Mic className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className={`font-bold ${profile.voiceId === voice ? 'text-brand-900' : 'text-slate-800'}`}>{voice}</h4>
                              <p className="text-xs text-slate-500">Gemini Native Voice</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                </div>
             )}

             {settingsTab === 'PHONE' && (
                <div className="p-8 flex flex-col items-center justify-center h-full text-center">
                   <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                      <Phone className="w-10 h-10 text-green-600" />
                   </div>
                   <h3 className="text-4xl font-bold text-slate-900 mb-2 font-mono tracking-tight">{profile.phoneNumber || 'No Number Assigned'}</h3>
                   <p className="text-slate-500 mb-8">This number is currently active and routing calls to your bot.</p>
                   <button 
                      onClick={getTwilioNumber}
                      className="px-6 py-2 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 font-medium text-sm"
                   >
                     Provision New Number
                   </button>
                </div>
             )}

             {settingsTab === 'APPS' && renderConnectedApps()}

             {settingsTab === 'SECURITY' && (
               <div className="p-8 max-w-2xl">
                  <h3 className="text-xl font-bold text-slate-900 mb-6">Security & Access Control</h3>
                  
                  <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 mb-6">
                     <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Lock className="w-5 h-5 text-slate-500" /> Admin Password
                     </h4>
                     <p className="text-sm text-slate-500 mb-4">
                       This password is required to exit Kiosk Mode.
                     </p>
                     
                     <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">Current Password</label>
                        <input 
                           type="text" 
                           value={profile.adminPassword || ''}
                           onChange={(e) => setProfile(p => ({...p, adminPassword: e.target.value}))}
                           className="w-full p-3 border border-slate-200 rounded-lg bg-white"
                        />
                     </div>
                  </div>
               </div>
             )}

          </div>
       </div>
    </div>
  );

  const renderDeployed = () => (
    <div className="h-screen w-screen bg-slate-900 text-white flex flex-col relative overflow-hidden">
       {/* Background Decoration */}
       <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 z-0"></div>
       <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-500 rounded-full blur-[150px] opacity-10 pointer-events-none"></div>
       <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-500 rounded-full blur-[150px] opacity-10 pointer-events-none"></div>

       {/* Top Nav (Kiosk Toggle) */}
       <div className="absolute top-6 right-6 z-30 flex bg-white/10 backdrop-blur-md rounded-full p-1 border border-white/10">
          {(['HOME', 'ORDER', 'RESERVE'] as const).map(kView => (
             <button
                key={kView}
                onClick={() => setKioskView(kView)}
                className={`px-6 py-2 rounded-full text-sm font-bold transition-all ${kioskView === kView ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-300 hover:text-white hover:bg-white/5'}`}
             >
                {kView.charAt(0) + kView.slice(1).toLowerCase()}
             </button>
          ))}
       </div>

       {/* View Content */}
       <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-8 w-full max-w-6xl mx-auto">
          
          {kioskView === 'HOME' && (
             <div className="animate-in fade-in zoom-in duration-500 text-center">
                <div className="mb-12">
                   <div className="w-20 h-20 bg-brand-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-brand-900/50 mx-auto mb-6 transform rotate-3">
                     <Mic className="w-10 h-10 text-white" />
                   </div>
                   <h1 className="text-5xl font-black tracking-tight mb-2">{profile.info.name || "Your Restaurant"}</h1>
                   <p className="text-xl text-slate-400 font-light">AI Concierge & Reservations</p>
                </div>

                <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center mx-auto max-w-md w-full">
                   <div className="mb-6 p-4 border-2 border-slate-900 rounded-xl">
                     <QRCode 
                        value={`tel:${profile.phoneNumber}`} 
                        size={240}
                        viewBox={`0 0 256 256`}
                      />
                   </div>
                   <p className="text-slate-500 text-sm font-bold uppercase tracking-widest mb-2">Scan or Call Now</p>
                   <p className="text-4xl font-black text-slate-900 tracking-wider font-mono">
                      {profile.phoneNumber || "---"}
                   </p>
                </div>
             </div>
          )}

          {kioskView === 'ORDER' && (
             <div className="flex w-full h-[600px] bg-white rounded-3xl overflow-hidden shadow-2xl text-slate-900 animate-in fade-in slide-in-from-right-8">
                {/* Left: Chat */}
                <div className="w-1/2 border-r border-slate-200 flex flex-col bg-slate-50">
                   <div className="p-4 border-b border-slate-200 bg-white">
                      <h3 className="font-bold text-lg flex items-center gap-2"><ShoppingBag className="w-5 h-5 text-orange-500" /> Order Assistant</h3>
                   </div>
                   <div className="flex-1 p-4 space-y-4">
                      {/* Simulated Chat */}
                      <div className="flex justify-start">
                         <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none shadow-sm text-sm">
                            Hi! What can I get started for you today? Check out our specials on the right.
                         </div>
                      </div>
                      <div className="flex justify-end">
                         <div className="bg-brand-600 text-white p-3 rounded-2xl rounded-tr-none shadow-sm text-sm">
                            I'll have the Spicy Rigatoni, please.
                         </div>
                      </div>
                      <div className="flex justify-start">
                         <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none shadow-sm text-sm">
                            Great choice! Would you like to add a Garlic Bread with that?
                         </div>
                      </div>
                   </div>
                   <div className="p-4 border-t border-slate-200 bg-white relative">
                      <input placeholder="Type your order..." className="w-full p-3 bg-slate-100 rounded-xl outline-none" disabled />
                      <button className="absolute right-6 top-1/2 -translate-y-1/2 bg-brand-600 p-2 rounded-lg text-white"><Send className="w-4 h-4" /></button>
                   </div>
                </div>
                {/* Right: Order Summary */}
                <div className="w-1/2 flex flex-col">
                   <div className="flex-1 p-8">
                      <h3 className="text-2xl font-bold mb-6">Your Order</h3>
                      <div className="space-y-4">
                         <div className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                            <div>
                               <p className="font-bold">Spicy Rigatoni</p>
                               <p className="text-sm text-slate-500">Extra Spicy</p>
                            </div>
                            <p className="font-bold">$24.00</p>
                         </div>
                      </div>
                      <div className="mt-8 pt-6 border-t border-slate-100">
                         <div className="flex justify-between text-lg font-bold">
                            <span>Total</span>
                            <span>$24.00</span>
                         </div>
                      </div>
                   </div>
                   <div className="p-6 border-t border-slate-100 flex gap-4 bg-slate-50">
                      <button onClick={() => setKioskView('HOME')} className="flex-1 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
                      <button className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 shadow-lg shadow-green-500/30">Checkout</button>
                   </div>
                </div>
             </div>
          )}

          {kioskView === 'RESERVE' && (
             <div className="flex w-full h-[600px] bg-white rounded-3xl overflow-hidden shadow-2xl text-slate-900 animate-in fade-in slide-in-from-right-8">
                {/* Left: Chat */}
                <div className="w-1/2 border-r border-slate-200 flex flex-col bg-slate-50">
                   <div className="p-4 border-b border-slate-200 bg-white">
                      <h3 className="font-bold text-lg flex items-center gap-2"><Calendar className="w-5 h-5 text-purple-500" /> Reservations</h3>
                   </div>
                   <div className="flex-1 p-4 space-y-4">
                      {/* Simulated Chat */}
                      <div className="flex justify-start">
                         <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none shadow-sm text-sm">
                            Welcome! When would you like to join us for dinner?
                         </div>
                      </div>
                      <div className="flex justify-end">
                         <div className="bg-brand-600 text-white p-3 rounded-2xl rounded-tr-none shadow-sm text-sm">
                            Tomorrow around 7pm for 4 people.
                         </div>
                      </div>
                      <div className="flex justify-start">
                         <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none shadow-sm text-sm">
                            I have a table available at 7:15 PM tomorrow. Does that work?
                         </div>
                      </div>
                   </div>
                   <div className="p-4 border-t border-slate-200 bg-white relative">
                      <input placeholder="Type your request..." className="w-full p-3 bg-slate-100 rounded-xl outline-none" disabled />
                      <button className="absolute right-6 top-1/2 -translate-y-1/2 bg-brand-600 p-2 rounded-lg text-white"><Send className="w-4 h-4" /></button>
                   </div>
                </div>
                {/* Right: Calendar Mock */}
                <div className="w-1/2 flex flex-col">
                   <div className="flex-1 p-8">
                      <h3 className="text-2xl font-bold mb-6">Select Date & Time</h3>
                      <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-100">
                         {/* Fake Calendar Grid */}
                         <div className="grid grid-cols-7 gap-2 text-center text-sm mb-2 font-bold text-slate-400">
                            <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
                         </div>
                         <div className="grid grid-cols-7 gap-2 text-center text-sm font-medium">
                            <span className="text-slate-300">29</span><span className="text-slate-300">30</span>
                            <span className="p-2">1</span><span className="p-2">2</span><span className="p-2 bg-brand-600 text-white rounded-full">3</span><span className="p-2">4</span><span className="p-2">5</span>
                         </div>
                      </div>
                      <div className="space-y-3">
                         <p className="font-bold text-sm text-slate-500 uppercase">Available Times</p>
                         <div className="flex gap-2 flex-wrap">
                            <button className="px-4 py-2 border border-slate-200 rounded-lg hover:border-brand-500 hover:text-brand-600 text-sm">6:00 PM</button>
                            <button className="px-4 py-2 border border-slate-200 rounded-lg hover:border-brand-500 hover:text-brand-600 text-sm">6:45 PM</button>
                            <button className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm shadow-lg shadow-brand-500/20">7:15 PM</button>
                            <button className="px-4 py-2 border border-slate-200 rounded-lg hover:border-brand-500 hover:text-brand-600 text-sm">8:00 PM</button>
                         </div>
                      </div>
                   </div>
                   <div className="p-6 border-t border-slate-100 flex gap-4 bg-slate-50">
                      <button onClick={() => setKioskView('HOME')} className="flex-1 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
                      <button className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 shadow-lg shadow-slate-900/30">Confirm</button>
                   </div>
                </div>
             </div>
          )}

       </div>

       {/* Admin Unlock Button */}
       <button 
          onClick={() => setShowUnlockModal(true)} 
          className="absolute bottom-6 right-6 p-3 text-slate-700 hover:text-white hover:bg-white/10 rounded-full transition-all z-20"
       >
          <Settings className="w-6 h-6" />
       </button>

       {/* Unlock Modal */}
       {showUnlockModal && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
             <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
                <h3 className="text-xl font-bold text-slate-900 mb-2 text-center">Admin Access</h3>
                <p className="text-slate-500 text-sm text-center mb-6">Enter password to exit Kiosk Mode</p>
                
                <form onSubmit={handleUnlock}>
                   <input 
                      type="password" 
                      autoFocus
                      placeholder="Enter Password"
                      className="w-full p-4 bg-slate-100 border border-slate-200 rounded-xl text-center text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500 mb-4"
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                   />
                   {unlockError && <p className="text-red-500 text-center text-sm font-medium mb-4">Incorrect Password</p>}
                   <div className="flex gap-3">
                      <button 
                        type="button" 
                        onClick={() => { setShowUnlockModal(false); setUnlockPassword(''); setUnlockError(false); }}
                        className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition"
                      >
                         Cancel
                      </button>
                      <button 
                        type="submit" 
                        className="flex-1 py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 transition shadow-lg shadow-brand-500/30"
                      >
                         Unlock
                      </button>
                   </div>
                </form>
             </div>
          </div>
       )}
    </div>
  );

  // --- Main Render ---

  if (view === 'DEPLOYED') {
     return renderDeployed();
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans relative">
      
      {/* Test Text Chat Modal Overlay */}
      {showTextChat && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-white rounded-2xl w-full max-w-lg h-[600px] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                 <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-brand-100 rounded-full flex items-center justify-center text-brand-600">
                       <Bot className="w-6 h-6" />
                    </div>
                    <div>
                       <h3 className="font-bold text-slate-900">Bot Simulator</h3>
                       <p className="text-xs text-slate-500">Testing current system prompt</p>
                    </div>
                 </div>
                 <button onClick={() => setShowTextChat(false)} className="p-2 hover:bg-slate-100 rounded-full">
                    <X className="w-5 h-5 text-slate-400" />
                 </button>
              </div>
              
              <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50">
                 {botChatHistory.length === 0 && (
                    <div className="text-center text-slate-400 mt-10 text-sm">
                       <p>Start chatting to test your bot configuration.</p>
                       <p>It will behave exactly as it would on the phone.</p>
                    </div>
                 )}
                 {botChatHistory.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                       <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-brand-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none shadow-sm'}`}>
                          {msg.text}
                       </div>
                    </div>
                 ))}
                 {isBotThinking && (
                    <div className="flex justify-start">
                       <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none shadow-sm flex gap-1 items-center">
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-200"></span>
                       </div>
                    </div>
                 )}
                 <div ref={botChatEndRef} />
              </div>

              <form onSubmit={handleBotChatSubmit} className="p-4 border-t border-slate-100 bg-white rounded-b-2xl">
                 <div className="relative">
                    <input 
                       className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                       placeholder="Say something..."
                       value={botChatMessage}
                       onChange={(e) => setBotChatMessage(e.target.value)}
                       autoFocus
                    />
                    <button 
                       type="submit" 
                       disabled={!botChatMessage.trim() || isBotThinking}
                       className="absolute right-2 top-2 p-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition"
                    >
                       <Send className="w-4 h-4" />
                    </button>
                 </div>
              </form>
           </div>
        </div>
      )}

      {/* Main UI Switching */}
      {view === 'DASHBOARD' ? (
         <div className="h-full w-full flex flex-col">
            <div className="flex-1 overflow-auto">
               <Dashboard 
                  profile={profile} 
                  onDeploy={() => setView('DEPLOYED')} 
                  onTextChat={() => setShowTextChat(true)}
               />
            </div>
            <div className="fixed bottom-6 left-6 z-40">
               <button 
                  onClick={() => setView('SETTINGS')}
                  className="bg-slate-900 text-white p-4 rounded-full shadow-xl hover:bg-slate-800 transition-all group flex items-center gap-0 hover:gap-2 overflow-hidden"
               >
                  <Settings className="w-6 h-6" />
                  <span className="max-w-0 group-hover:max-w-xs transition-all duration-300 opacity-0 group-hover:opacity-100 whitespace-nowrap text-sm font-bold">Settings</span>
               </button>
            </div>
         </div>
      ) : view === 'SETTINGS' ? (
         <div className="flex w-full h-full bg-slate-50 overflow-hidden font-sans">
            {/* Settings Sidebar Logic Repeated (Ideally Componentized) */}
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
             
             <nav className="flex-1 p-6 space-y-1">
                <button onClick={() => setView('DASHBOARD')} className="w-full text-left flex items-center gap-4 px-4 py-4 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition">
                   <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center"><ArrowRight className="w-4 h-4" /></div>
                   <span className="font-medium text-sm">Back to Dashboard</span>
                </button>
             </nav>

             <div className="p-8 border-t border-slate-800/50">
               <div className="bg-slate-800/50 rounded-lg p-4 backdrop-blur-sm flex items-center justify-between">
                 <div>
                    <p className="text-xs text-slate-400 font-medium">Logged in as</p>
                    <p className="text-sm text-white font-bold truncate w-32">restaurateur@menyo.com</p>
                 </div>
               </div>
             </div>
          </div>
          <div className="flex-1 bg-slate-50 overflow-auto">
             {renderSettings()}
          </div>
         </div>
      ) : (
         /* Wizard View */
         <>
          <div className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0 z-20 shadow-2xl">
             {/* Wizard Sidebar Content */}
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
                 { id: 4, label: 'Knowledge Base' },
                 { id: 5, label: 'Phone Setup' },
                 { id: 6, label: 'Voice Config' },
               ].map((item) => {
                 const isActive = step === item.id;
                 const isCompleted = step > item.id;
                 
                 return (
                   <div key={item.id} className="group flex items-center gap-4 px-4 py-4 rounded-xl transition-colors select-none">
                     <div className={`
                       w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300
                       ${isActive ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/40 scale-110' : 
                         isCompleted ? 'bg-green-500 text-white' : 'bg-slate-800 text-slate-500'}
                     `}>
                       {isCompleted ? <Check className="w-4 h-4" /> : item.id}
                     </div>
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
               <div className="bg-slate-800/50 rounded-lg p-4 backdrop-blur-sm flex items-center justify-between">
                 <div>
                    <p className="text-xs text-slate-400 font-medium">Logged in as</p>
                    <p className="text-sm text-white font-bold truncate w-32">restaurateur@menyo.com</p>
                 </div>
                 <button 
                    onClick={() => setView('SETTINGS')} 
                    className="text-slate-400 hover:text-white transition p-1 hover:bg-slate-700 rounded"
                 >
                    <Settings className="w-5 h-5" />
                 </button>
               </div>
             </div>
          </div>

          <div className="flex-1 relative overflow-y-auto bg-slate-50">
            <div className="max-w-6xl mx-auto py-12 px-8 h-full">
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-10 md:p-14 transition-all animate-in fade-in slide-in-from-bottom-4 duration-500 min-h-[600px] flex flex-col">
                {step === 1 && renderStep1_Menu()}
                {step === 2 && renderStep2_Google()}
                {step === 3 && renderStep3_Integrations()}
                {step === 4 && renderStep4_KnowledgeBase()}
                {step === 5 && renderStep5_Phone()}
                {step === 6 && renderStep6_Voice()}
              </div>
              
              <div className="text-center mt-8 text-slate-400 text-sm font-medium">
                 Press <span className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-500 text-xs">Enter</span> to continue
              </div>
            </div>
          </div>
         </>
      )}
    </div>
  );
}

export default App;
