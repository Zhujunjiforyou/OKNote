import { forwardRef, type SVGProps } from 'react'
import paths from './icon-paths.json'

// OKNote's compact controls share one 24-unit drawing grid and rounded ink.
// Thin detail is avoided so the same marks remain legible at desktop sizes.
export interface IconProps extends SVGProps<SVGSVGElement> { size?: number | string }
function icon(name: keyof typeof paths) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(({ size = 24, strokeWidth = 1.8, className = '', ...props }, ref) => (
    <svg ref={ref} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      className={`oknote-icon ${className}`} data-icon={name} {...props}>
      {paths[name].map((d, index) => <path key={index} d={d} />)}
    </svg>
  ))
  Icon.displayName = name
  return Icon
}

export const Plus = icon('Plus')
export const X = icon('X')
export const Check = icon('Check')
export const CheckCheck = icon('CheckCheck')
export const ChevronLeft = icon('ChevronLeft')
export const ChevronRight = icon('ChevronRight')
export const MoreHorizontal = icon('MoreHorizontal')
export const GripHorizontal = icon('GripHorizontal')
export const CalendarDays = icon('CalendarDays')
export const CalendarPlus = icon('CalendarPlus')
export const CalendarRange = icon('CalendarRange')
export const CalendarClock = icon('CalendarClock')
export const StickyNote = icon('StickyNote')
export const ListTodo = icon('ListTodo')
export const Bell = icon('Bell')
export const Clock = icon('Clock')
export const Repeat = icon('Repeat')
export const Repeat2 = icon('Repeat2')
export const RotateCcw = icon('RotateCcw')
export const RefreshCw = icon('RefreshCw')
export const Trash2 = icon('Trash2')
export const Pencil = icon('Pencil')
export const Tag = icon('Tag')
export const MapPin = icon('MapPin')
export const Eye = icon('Eye')
export const EyeOff = icon('EyeOff')
export const Sun = icon('Sun')
export const Moon = icon('Moon')
export const Globe = icon('Globe')
export const Settings = icon('Settings')
export const AlertTriangle = icon('AlertTriangle')
