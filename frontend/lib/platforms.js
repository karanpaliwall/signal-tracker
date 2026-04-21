export const PLATFORMS = [
  { key: 'linkedin',  label: 'LinkedIn',  flag: 'US', cost: 'Free' },
  { key: 'indeed',    label: 'Indeed',    flag: 'US', cost: '~$3.00/1K' },
  { key: 'glassdoor', label: 'Glassdoor', flag: 'US', cost: '~$3.00/1K' },
  { key: 'monster',   label: 'Monster',   flag: 'US', cost: '~$0.99/1K' },
  { key: 'naukri',    label: 'Naukri',    flag: 'IN', cost: '~$1.00/1K' },
]

export const PLATFORM_KEYS = PLATFORMS.map(p => p.key)

export const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map(p => [p.key, p.label]))
