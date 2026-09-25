import type { DeliveryFailureReason, DeliveryStatus, DriverApprovalStatus, OrderStatus } from "../generated/prisma/client";

/**
 * Every fixed notification string, in one place.
 *
 * The server does not know which language a user reads (there is no per-user locale), and a push is
 * shown by the phone itself, before any app code can translate it. So each string carries Arabic and
 * English together, "Arabic · English" — the same convention the driver delivery alert already
 * used. Arabic comes first because it is the app's default language.
 *
 * If a per-user or per-device locale is ever stored, this file is the only thing that has to change:
 * `both` becomes a lookup and every call site stays as it is.
 *
 * Free text an operator typed (a rejection reason, a note) is passed through untouched.
 */
export type Copy = { title: string; body: string };

const both = (ar: string, en: string): string => `${ar} · ${en}`;

export function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ILS`;
}

// --- orders ---------------------------------------------------------------------------------

export function newOrderForBusiness(totalMinor: number): Copy {
  const price = formatPrice(totalMinor);
  return {
    title: both("طلب جديد", "New order received"),
    body: both(`طلب جديد بقيمة ${price} بانتظار ردّك.`, `A new order for ${price} is waiting for your response.`)
  };
}

export function productDecisionNeeded(productName: string, hasReplacement: boolean): Copy {
  return {
    title: both("المتجر يحتاج قرارك بشأن منتج", "Your supermarket needs a product decision"),
    body: hasReplacement
      ? both(
          `${productName}: تم اقتراح بديل. راجعه قبل أن يقبل المتجر طلبك.`,
          `${productName} has a proposed replacement. Review it before the store accepts your order.`
        )
      : both(
          `${productName}: تم تعديل الكمية المجهّزة. راجعها قبل أن يقبل المتجر طلبك.`,
          `${productName} has a packed quantity update. Review it before the store accepts your order.`
        )
  };
}

export function fulfillmentDecisionForBusiness(decision: "APPROVED" | "REJECTED"): Copy {
  return decision === "APPROVED"
    ? {
        title: both("تمت الموافقة على تغيير المنتج", "Fulfillment change approved"),
        body: both(
          "وافق العميل على البديل أو الكمية المقترحة.",
          "The customer approved the proposed product or packed quantity."
        )
      }
    : {
        title: both("تم رفض تغيير المنتج", "Fulfillment change rejected"),
        body: both(
          "رفض العميل الاقتراح. يمكنك إرسال اقتراح جديد أو تجهيز المنتج الأصلي.",
          "The customer rejected the proposal. You can send a revised proposal or fulfill the original product."
        )
      };
}

export function orderStatusTitle(status: OrderStatus): string {
  switch (status) {
    case "ACCEPTED":
      return both("تم قبول طلبك", "Your order was accepted");
    case "PREPARING":
      return both("طلبك قيد التحضير", "Your order is being prepared");
    case "READY_FOR_PICKUP":
      return both("طلبك جاهز وبانتظار سائق", "Your order is ready and waiting for a driver");
    case "REJECTED":
      return both("تم رفض طلبك", "Your order was rejected");
    case "DELIVERED":
      return both("تم توصيل طلبك", "Your order has been delivered");
    case "CANCELLED":
      return both("تم إلغاء طلبك", "Your order was cancelled");
    default:
      return both("تغيّرت حالة طلبك", "Your order status has changed");
  }
}

export function orderStatusForCustomer(status: OrderStatus, note: string | undefined): Copy {
  const trimmedNote = note?.trim();
  const title = orderStatusTitle(status);
  if (status === "REJECTED" && trimmedNote) {
    return {
      title,
      body: both(
        `تعذّر على المتجر قبول هذا الطلب. السبب: ${trimmedNote}`,
        `The store could not accept this order. Reason: ${trimmedNote}`
      )
    };
  }
  return { title, body: trimmedNote || title };
}

export function orderCancelledByCustomerForBusiness(): Copy {
  return {
    title: both("ألغى العميل الطلب", "Order cancelled by customer"),
    body: both("ألغى العميل هذا الطلب قبل قبوله.", "The customer cancelled this order before it was accepted.")
  };
}

export function orderCancelledByAdminForCustomer(reason: string): Copy {
  return {
    title: both("تم إلغاء طلبك", "Your order was cancelled"),
    body: both(`ألغت الإدارة هذا الطلب. السبب: ${reason}`, `An administrator cancelled this order. Reason: ${reason}`)
  };
}

export function orderCancelledByAdminForBusiness(reason: string): Copy {
  return {
    title: both("ألغت الإدارة طلباً", "An order was cancelled by an administrator"),
    body: both(`السبب: ${reason}`, `Reason: ${reason}`)
  };
}

export function deliveryCancelledForDriver(): Copy {
  return {
    title: both("أُلغي التوصيل", "Delivery cancelled"),
    body: both(
      "ألغت الإدارة هذا الطلب، ولم تعد بحاجة إلى توصيله.",
      "An administrator cancelled this order. You no longer need to deliver it."
    )
  };
}

/** The alert to on-shift drivers. Names only the pickup store: a lock screen must not show an address. */
export function deliveryAvailable(storeName: string): Copy {
  return {
    title: both("طلب توصيل جديد", "New delivery"),
    body: `${storeName} — افتح التطبيق للقبول · Open the app to accept`
  };
}

// --- deliveries -----------------------------------------------------------------------------

export function driverAssignedForCustomer(): Copy {
  return {
    title: both("سائق في الطريق", "A driver is on the way"),
    body: both("تم تعيين سائق لاستلام طلبك.", "A driver has been assigned to pick up your order.")
  };
}

export function deliveryStatusForCustomer(status: DeliveryStatus): Copy {
  switch (status) {
    case "PICKED_UP":
      return {
        title: both("تم استلام طلبك", "Your order has been picked up"),
        body: both("استلم السائق طلبك من المتجر.", "The driver has picked up your order from the store.")
      };
    case "ON_THE_WAY":
      return {
        title: both("طلبك في الطريق", "Your order is on the way"),
        body: both("السائق في طريقه إلى عنوان التوصيل.", "The driver is on the way to your delivery address.")
      };
    case "DELIVERED":
      return {
        title: both("تم توصيل طلبك", "Your order has been delivered"),
        body: both(
          "شكراً لطلبك من JOVO! تم تسجيل طلبك كمُسلَّم.",
          "Thank you for ordering with JOVO! Your order has been marked as delivered."
        )
      };
    case "FAILED":
      return {
        title: both("تعذّر توصيل طلبك", "Your order could not be delivered"),
        body: both(
          "لم يتمكن السائق من إتمام هذا التوصيل. تواصل مع الدعم إن احتجت مساعدة.",
          "The driver could not complete this delivery. Please contact support if you need help."
        )
      };
    default:
      return {
        title: both("تحديث على التوصيل", "Delivery update"),
        body: both("تغيّرت حالة التوصيل.", "Your delivery status has changed.")
      };
  }
}

const failureReasonLabels: Record<DeliveryFailureReason, { ar: string; en: string }> = {
  CUSTOMER_REFUSED: { ar: "رفض العميل الاستلام", en: "the customer refused the order" },
  CUSTOMER_UNREACHABLE: { ar: "تعذّر الوصول إلى العميل", en: "the customer could not be reached" },
  WRONG_ADDRESS: { ar: "العنوان غير صحيح", en: "the address was wrong" },
  BUSINESS_ERROR: { ar: "خطأ من المتجر", en: "there was a problem on the store's side" },
  DRIVER_ISSUE: { ar: "مشكلة لدى السائق", en: "the driver had a problem" },
  OTHER: { ar: "سبب آخر", en: "another reason" }
};

export function failureReasonLabel(reason: DeliveryFailureReason | null | undefined): { ar: string; en: string } {
  return (reason && failureReasonLabels[reason]) || failureReasonLabels.OTHER;
}

export function deliveryFailedForBusiness(reason: DeliveryFailureReason | null | undefined): Copy {
  const label = failureReasonLabel(reason);
  return {
    title: both("تعذّر إتمام توصيلة", "A delivery could not be completed"),
    body: both(`أبلغ السائق: ${label.ar}.`, `The driver reported that ${label.en}.`)
  };
}

/** Admins are told a delivery failed because someone has to decide what happens to the order. */
export function deliveryFailedForAdmin(orderRef: string, reason: DeliveryFailureReason | null | undefined): Copy {
  const label = failureReasonLabel(reason);
  return {
    title: both("توصيلة فاشلة", "Delivery failed"),
    body: both(`الطلب ${orderRef}: ${label.ar}.`, `Order ${orderRef}: ${label.en}.`)
  };
}

// --- accounts -------------------------------------------------------------------------------

export function driverAccountStatus(status: DriverApprovalStatus, reason: string | null | undefined): Copy {
  let title: string;
  switch (status) {
    case "APPROVED":
      title = both("تمت الموافقة على حساب السائق", "Your driver account has been approved");
      break;
    case "REJECTED":
      title = both("لم تتم الموافقة على طلب انضمامك كسائق", "Your driver application was not approved");
      break;
    case "SUSPENDED":
      title = both("تم تعليق حساب السائق", "Your driver account has been suspended");
      break;
    default:
      title = both("تغيّرت حالة حساب السائق", "Your driver account status has changed");
  }
  return { title, body: reason ? both(`السبب: ${reason}`, `Reason: ${reason}`) : title };
}

export function restaurantReview(approved: boolean, reason: string | null | undefined): Copy {
  if (approved) {
    return {
      title: both("تمت الموافقة على متجرك", "Your restaurant was approved"),
      body: both(
        "تهانينا! متجرك يعمل الآن ويمكنه استقبال الطلبات.",
        "Congratulations! Your restaurant is now live and can start accepting orders."
      )
    };
  }
  return {
    title: both("تم رفض طلب تسجيل متجرك", "Your restaurant application was rejected"),
    body: reason
      ? both(
          `لم تتم الموافقة على طلب تسجيل متجرك. السبب: ${reason}`,
          `Your restaurant application was not approved. Reason: ${reason}`
        )
      : both(
          "لم تتم الموافقة على طلب تسجيل متجرك. تواصل مع الدعم لمعرفة التفاصيل.",
          "Your restaurant application was not approved. Please contact support for details."
        )
  };
}

export function restaurantSuspension(suspended: boolean, reason: string | null | undefined): Copy {
  return {
    title: suspended
      ? both("تم تعليق متجرك", "Your restaurant has been suspended")
      : both("تمت إعادة تفعيل متجرك", "Your restaurant has been reactivated"),
    body: reason
      ? both(`السبب: ${reason}`, `Reason: ${reason}`)
      : both("يمكن لمتجرك استقبال الطلبات مجدداً.", "Your restaurant can accept orders again.")
  };
}
