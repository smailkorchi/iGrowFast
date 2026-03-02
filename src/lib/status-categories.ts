export const ORDER_CATEGORIES = {
  NEW: 'new',
  INTERESTED: 'interested',
  CALLBACK: 'callback',
  CONFIRMED: 'confirmed',
  PROCESSED: 'processed',
  PAID: 'paid',
  UNPAID: 'unpaid',
  CANCELLED: 'cancelled',
  FAKE: 'fake',
  DOUBLE: 'double',
  RETURN: 'return',
  RECHECK: 'recheck',
  POSTPONED: 'postponed',
  BLACKLISTED: 'blacklisted',
  REPORTED: 'postponed',
  RELAUNCH_NEW: 'relaunch_new',
  OTHER: 'other',
} as const;

export type OrderCategory = (typeof ORDER_CATEGORIES)[keyof typeof ORDER_CATEGORIES];

export const PKG_CATEGORIES = {
  NEW: 'new',
  PICKUP_PENDING: 'pickup_pending',
  PICKED_UP: 'picked_up',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  RETURNED: 'returned',
  RETURNING: 'returning',
  REFUSED: 'refused',
  POSTPONED: 'postponed',
  SCHEDULED: 'scheduled',
  RECHECK: 'recheck',
  CANCELLED: 'cancelled',
  CALLBACK: 'callback',
  INTERESTED: 'interested',
  RELAUNCH: 'relaunch',
  OTHER: 'other',
} as const;

export type PkgCategory = (typeof PKG_CATEGORIES)[keyof typeof PKG_CATEGORIES];

export const CONFIRMED_ORDER_CATS: OrderCategory[] = ['confirmed', 'processed', 'paid', 'unpaid'];
export const CANCELLED_ORDER_CATS: OrderCategory[] = ['cancelled', 'fake', 'double', 'blacklisted'];
export const CALLBACK_ORDER_CATS: OrderCategory[] = ['callback'];
export const PENDING_ORDER_CATS: OrderCategory[] = ['new', 'interested'];

export const SHIPPED_PKG_CATS: PkgCategory[] = ['in_transit', 'out_for_delivery', 'picked_up', 'pickup_pending'];
export const DELIVERED_PKG_CATS: PkgCategory[] = ['delivered'];
export const RETURNED_PKG_CATS: PkgCategory[] = ['returned', 'returning', 'refused'];

export const ORDER_CATEGORY_COLORS: Record<string, string> = {
  new: '#6b7280',
  interested: '#3b82f6',
  callback: '#f44848',
  confirmed: '#10b981',
  processed: '#37d7aa',
  paid: '#09951a',
  unpaid: '#000000',
  cancelled: '#ef4444',
  fake: '#dc2626',
  double: '#f44848',
  return: '#ff1900',
  recheck: '#f59e0b',
  postponed: '#a855f6',
  blacklisted: '#e81111',
  relaunch_new: '#9c9bf3',
  other: '#6b7280',
};

export const PKG_CATEGORY_COLORS: Record<string, string> = {
  new: '#3b82f6',
  pickup_pending: '#f59e0b',
  picked_up: '#f59e0b',
  in_transit: '#8b5cf6',
  out_for_delivery: '#6f90d3',
  delivered: '#10b981',
  returned: '#ef4444',
  returning: '#ff0000',
  refused: '#b50d0d',
  postponed: '#b5b82e',
  scheduled: '#904747',
  recheck: '#f59e0b',
  cancelled: '#ef4444',
  callback: '#ff9500',
  interested: '#38a829',
  relaunch: '#29dbbd',
  other: '#6b7280',
};
