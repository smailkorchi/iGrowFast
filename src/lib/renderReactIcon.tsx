import { type ComponentType } from 'react';
import {
    FaArchive, FaBan, FaBarcode, FaBell, FaBox, FaBoxOpen, FaBoxes, FaBuilding, FaCalendarAlt,
    FaCalendarCheck, FaCheck, FaCheckCircle, FaClipboardCheck, FaClipboardList, FaClock, FaCog,
    FaComment, FaCommentDots, FaCopy, FaCreditCard, FaDolly, FaEnvelope, FaExclamationCircle,
    FaExclamationTriangle, FaEye, FaEyeSlash, FaFlag, FaGift, FaHandHolding, FaHandHoldingMedical,
    FaHeadset, FaHome, FaHourglassHalf, FaInfoCircle, FaLocationArrow, FaMapMarkerAlt, FaMapPin,
    FaMoneyBillWave, FaPause, FaPercent, FaPhone, FaPhoneAlt, FaPhoneSlash, FaPlane, FaQrcode,
    FaQuestionCircle, FaReceipt, FaRedo, FaRegStar, FaRoute, FaSearch, FaShip, FaShippingFast,
    FaShoppingCart, FaSms, FaStar, FaStore, FaSync, FaTag, FaThumbsDown, FaThumbsUp, FaTimes,
    FaTimesCircle, FaTruck, FaTruckLoading, FaTruckMoving, FaTruckPickup, FaUndo, FaUndoAlt, FaUser,
    FaUserCheck, FaUserPlus, FaUserTimes, FaUsers, FaVoicemail, FaWallet, FaWarehouse,
    FaWeightHanging, FaWhatsapp,
} from 'react-icons/fa';
import {
    TbAlertTriangle, TbBell, TbBox, TbCircleCheck, TbCircleX, TbClock, TbInfoCircle, TbMapPin,
    TbPackage, TbPackages, TbPhone, TbRefresh, TbRepeat, TbTruck, TbTruckDelivery, TbUser,
    TbUserCheck,
} from 'react-icons/tb';
import {
    BsArrowRepeat, BsArrowReturnLeft, BsArrowReturnRight, BsBell, BsBox, BsBoxSeam, BsCart,
    BsCheckCircle, BsClockHistory, BsExclamationTriangle, BsGeoAlt, BsInfoCircle, BsPerson,
    BsReceipt, BsTelephone, BsTruck, BsXCircle,
} from 'react-icons/bs';

type IconComp = ComponentType<{ className?: string; style?: React.CSSProperties }>;

/**
 * Curated status-icon palette. This is the ENTIRE react-icons surface the app loads:
 * a static, tree-shaken map (react-icons 5.7 = sideEffects:false + ESM) covering every
 * icon currently stored in order_statuses.icon / package_statuses.icon (verified against
 * the live DB 2026-07-16) plus a featured delivery/status set for the owner picker.
 *
 * The former whole-pack dynamic loaders (`import('react-icons/fa'|'tb'|'bs')`, ~5.5 MB)
 * were removed: because those packs were ALSO statically imported (brand icons in the
 * sidebars), the dynamic import could not be split off and forced the whole ~5.5 MB into
 * the eager bundle. Curating to this list drops react-icons to ~tens of KB. The owner
 * IconPicker now selects from this palette; every stored icon is guaranteed present here.
 */
const CURATED_ICONS: Record<string, IconComp> = {
    FaArchive, FaBan, FaBarcode, FaBell, FaBox, FaBoxOpen, FaBoxes, FaBuilding, FaCalendarAlt,
    FaCalendarCheck, FaCheck, FaCheckCircle, FaClipboardCheck, FaClipboardList, FaClock, FaCog,
    FaComment, FaCommentDots, FaCopy, FaCreditCard, FaDolly, FaEnvelope, FaExclamationCircle,
    FaExclamationTriangle, FaEye, FaEyeSlash, FaFlag, FaGift, FaHandHolding, FaHandHoldingMedical,
    FaHeadset, FaHome, FaHourglassHalf, FaInfoCircle, FaLocationArrow, FaMapMarkerAlt, FaMapPin,
    FaMoneyBillWave, FaPause, FaPercent, FaPhone, FaPhoneAlt, FaPhoneSlash, FaPlane, FaQrcode,
    FaQuestionCircle, FaReceipt, FaRedo, FaRegStar, FaRoute, FaSearch, FaShip, FaShippingFast,
    FaShoppingCart, FaSms, FaStar, FaStore, FaSync, FaTag, FaThumbsDown, FaThumbsUp, FaTimes,
    FaTimesCircle, FaTruck, FaTruckLoading, FaTruckMoving, FaTruckPickup, FaUndo, FaUndoAlt, FaUser,
    FaUserCheck, FaUserPlus, FaUserTimes, FaUsers, FaVoicemail, FaWallet, FaWarehouse,
    FaWeightHanging, FaWhatsapp,
    TbAlertTriangle, TbBell, TbBox, TbCircleCheck, TbCircleX, TbClock, TbInfoCircle, TbMapPin,
    TbPackage, TbPackages, TbPhone, TbRefresh, TbRepeat, TbTruck, TbTruckDelivery, TbUser,
    TbUserCheck,
    BsArrowRepeat, BsArrowReturnLeft, BsArrowReturnRight, BsBell, BsBox, BsBoxSeam, BsCart,
    BsCheckCircle, BsClockHistory, BsExclamationTriangle, BsGeoAlt, BsInfoCircle, BsPerson,
    BsReceipt, BsTelephone, BsTruck, BsXCircle,
};

const ALL_ICON_NAMES = Object.keys(CURATED_ICONS);

/** Sync lookup of a stored icon name to its component (null if not in the palette). */
export function getIconComponent(name: string): IconComp | null {
    if (!name) return null;
    return CURATED_ICONS[name] ?? null;
}

/** Kept async for the IconPicker call-site; now resolves the curated palette (no pack load). */
export async function getAllIconNamesAsync(): Promise<string[]> {
    return ALL_ICON_NAMES;
}

export function DynamicIcon({
    name,
    className,
    style,
}: {
    name: string | null | undefined;
    className?: string;
    style?: React.CSSProperties;
}) {
    const Icon = name ? CURATED_ICONS[name] : null;
    if (!Icon) return null;
    return <Icon className={className} style={style} />;
}
