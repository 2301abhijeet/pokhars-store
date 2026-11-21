import type { Timestamp } from "firebase/firestore";

export type ProductDocument = {
  name: string;
  slug: string;
  description: string;
  flavour: string;
  category: string;
  imageUrl: string;
  pricePaise: number;
  compareAtPricePaise?: number;
  netWeightGrams: number;
  isActive: boolean;
  visibility: "draft" | "published";
  sortOrder: number;
  stockQuantity: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CustomerProfileDocument = {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CartItemDocument = {
  productId: string;
  quantity: number;
  updatedAt: Timestamp;
};

export type AddressDocument = {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type OrderStatus =
  | "pending_payment"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export type OrderDocument = {
  userId: string;
  orderNumber: string;
  items: Array<{
    productId: string;
    nameSnapshot: string;
    unitPricePaise: number;
    quantity: number;
    lineTotalPaise: number;
  }>;
  subtotalPaise: number;
  shippingPaise: number;
  discountPaise: number;
  totalPaise: number;
  status: OrderStatus;
  paymentStatus: "created" | "paid" | "failed" | "refunded";
  paymentMode?: "test" | "live";
  paymentId?: string;
  razorpayOrderId?: string;
  stockReserved?: boolean;
  reservationExpiresAt?: Timestamp;
  inventoryIssue?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
