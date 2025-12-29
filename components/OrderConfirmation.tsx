import React from 'react';
import { CheckCircle, Clock, Package, Phone, Mail } from 'lucide-react';

export interface OrderConfirmationProps {
  orderId: string;
  customerName: string;
  total: number;
  estimatedReadyTime?: string;
  orderType: string;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'COMPLETED';
  phone?: string;
  email?: string;
  onClose?: () => void;
}

export const OrderConfirmation: React.FC<OrderConfirmationProps> = ({
  orderId,
  customerName,
  total,
  estimatedReadyTime,
  orderType,
  status,
  phone,
  email,
  onClose,
}) => {
  const getStatusColor = () => {
    switch (status) {
      case 'CONFIRMED':
        return 'text-green-600 bg-green-50';
      case 'PREPARING':
        return 'text-blue-600 bg-blue-50';
      case 'READY':
        return 'text-orange-600 bg-orange-50';
      case 'COMPLETED':
        return 'text-purple-600 bg-purple-50';
      default:
        return 'text-slate-600 bg-slate-50';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'CONFIRMED':
      case 'COMPLETED':
        return <CheckCircle className="w-6 h-6" />;
      case 'PREPARING':
        return <Package className="w-6 h-6" />;
      case 'READY':
        return <Clock className="w-6 h-6" />;
      default:
        return <Clock className="w-6 h-6" />;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        )}

        <div className="text-center mb-6">
          <div className={`w-16 h-16 rounded-full ${getStatusColor()} flex items-center justify-center mx-auto mb-4`}>
            {getStatusIcon()}
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Order Confirmed!</h2>
          <p className="text-slate-600">Your order has been received</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-6 mb-6">
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-500 mb-1">Order Number</p>
              <p className="text-2xl font-bold text-slate-900">#{orderId}</p>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <p className="text-sm text-slate-500 mb-1">Customer</p>
              <p className="font-medium text-slate-900">{customerName}</p>
              {phone && (
                <p className="text-sm text-slate-600 flex items-center gap-2 mt-1">
                  <Phone className="w-4 h-4" />
                  {phone}
                </p>
              )}
              {email && (
                <p className="text-sm text-slate-600 flex items-center gap-2 mt-1">
                  <Mail className="w-4 h-4" />
                  {email}
                </p>
              )}
            </div>

            <div className="border-t border-slate-200 pt-4">
              <p className="text-sm text-slate-500 mb-1">Order Type</p>
              <p className="font-medium text-slate-900 capitalize">{orderType.toLowerCase()}</p>
            </div>

            {estimatedReadyTime && (
              <div className="border-t border-slate-200 pt-4">
                <p className="text-sm text-slate-500 mb-1">Estimated Ready Time</p>
                <p className="font-medium text-slate-900">
                  {new Date(estimatedReadyTime).toLocaleString()}
                </p>
              </div>
            )}

            <div className="border-t border-slate-200 pt-4">
              <div className="flex justify-between items-center">
                <p className="text-lg font-bold text-slate-900">Total</p>
                <p className="text-2xl font-bold text-slate-900">${total.toFixed(2)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className={`rounded-lg p-4 ${getStatusColor()}`}>
          <div className="flex items-center gap-3">
            {getStatusIcon()}
            <div>
              <p className="font-medium capitalize">{status.toLowerCase()}</p>
              <p className="text-sm opacity-80">
                {status === 'CONFIRMED' && 'Your order is confirmed and being prepared'}
                {status === 'PREPARING' && 'Your order is being prepared'}
                {status === 'READY' && 'Your order is ready for pickup!'}
                {status === 'COMPLETED' && 'Your order has been completed'}
                {status === 'PENDING' && 'Your order is pending confirmation'}
              </p>
            </div>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="w-full mt-6 bg-slate-900 text-white py-3 rounded-lg font-bold hover:bg-slate-800 transition"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
};
