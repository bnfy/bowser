// Native Icon Composer asset names and source colors for every Dock colorway.
// `scripts/after-pack-app-icons.js` compiles these into one Assets.car; the
// runtime selects the named icon stack without flattening it, so macOS remains
// free to render Default, Dark, Clear, or Tinted (including the user's tint).
// Keep ids aligned with settings.js APP_ICON_LABELS/SUPPORTER_ICON_LABELS.
module.exports = {
  paper: {
    nativeName: 'Icon',
    background: '#FFFFFF',
    foreground: '#0E0E0E',
    darkForeground: '#F4F4F4',
  },
  ink: {
    nativeName: 'Ink',
    background: '#0D0D0D',
    foreground: '#F4F4F4',
    darkForeground: '#F4F4F4',
  },
  graphite: {
    nativeName: 'Graphite',
    background: '#626262',
    foreground: '#F4F4F4',
    darkForeground: '#F4F4F4',
  },
  default: {
    nativeName: 'Evergreen',
    background: '#2F4639',
    foreground: '#F4F4F1',
    darkForeground: '#F4F4F1',
  },
  midnight: {
    nativeName: 'Midnight',
    background: '#141815',
    foreground: '#44604F',
    darkForeground: '#6B9080',
  },
  cream: {
    nativeName: 'Cream',
    background: '#F7F5EE',
    foreground: '#2F4639',
    darkForeground: '#F7F5EE',
  },
  forest: {
    nativeName: 'Forest',
    background: '#1F251F',
    foreground: '#6B9080',
    darkForeground: '#6B9080',
  },
  sage: {
    nativeName: 'Sage',
    background: '#6B9080',
    foreground: '#FFFFFF',
    darkForeground: '#FFFFFF',
  },
  ember: {
    nativeName: 'Ember',
    background: '#824C3B',
    foreground: '#F6EDE4',
    darkForeground: '#F6EDE4',
  },
  plum: {
    nativeName: 'Plum',
    background: '#4A3B52',
    foreground: '#E6DFEE',
    darkForeground: '#E6DFEE',
  },
  gold: {
    nativeName: 'Gold',
    background: '#201B10',
    foreground: '#C2A566',
    darkForeground: '#C2A566',
  },
};
