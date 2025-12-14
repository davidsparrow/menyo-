import React, { useEffect, useState } from 'react';
import { getCurrentUser, onAuthStateChange, AuthUser } from '../../lib/auth';
import { Login } from './Login';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check initial auth state
    getCurrentUser()
      .then((currentUser) => {
        setUser(currentUser);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error getting current user:', err);
        setError(err.message || 'Failed to load user');
        setLoading(false);
      });

    // Listen for auth changes
    try {
      const { data: { subscription } } = onAuthStateChange(async (event, session) => {
        try {
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            const currentUser = await getCurrentUser();
            setUser(currentUser);
          } else if (event === 'SIGNED_OUT') {
            setUser(null);
          }
        } catch (err) {
          console.error('Error in auth state change handler:', err);
        }
      });

      return () => {
        subscription.unsubscribe();
      };
    } catch (err) {
      console.error('Error setting up auth listener:', err);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
          <p className="mt-4 text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Configuration Error</h1>
          <p className="text-slate-600 mb-4">{error}</p>
          <p className="text-sm text-slate-500 mb-4">
            Please check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your environment variables.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-brand-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-700"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onAuthSuccess={() => getCurrentUser().then(setUser).catch(console.error)} />;
  }

  return <>{children}</>;
};

