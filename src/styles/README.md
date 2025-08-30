# Styling System

This folder contains all the styling for the Wallet Manager application, organized in a modular and maintainable way.

## Folder Structure

```
src/styles/
├── README.md                 # This file
├── globals.css              # Global styles and theme imports
├── shared/                  # Shared styling utilities
│   └── theme.css           # Dark mode theme system with CSS variables
├── components/              # Component-specific CSS modules
│   ├── Navbar.module.css   # Navigation bar styles
│   └── WalletInfo.module.css # Wallet information component styles
└── pages/                   # Page-specific CSS modules
    └── Home.module.css     # Home page styles
```

## Theme System

The application uses a comprehensive dark mode theme system with CSS custom properties (variables) defined in `shared/theme.css`.

### Color Palette

- **Background Colors**: Dark theme with multiple levels of depth
- **Foreground Colors**: High contrast text colors for accessibility
- **Accent Colors**: Brand colors for interactive elements
- **Border Colors**: Subtle borders for component separation

### CSS Variables

All styling uses CSS custom properties for consistency:

```css
:root {
    --background-primary: #0a0a0a;
    --foreground-primary: #ffffff;
    --accent-primary: #667eea;
    --spacing-md: 16px;
    --radius-md: 12px;
    /* ... and many more */
}
```

### Benefits

1. **Consistency**: All components use the same color palette and spacing
2. **Maintainability**: Easy to update colors globally
3. **Dark Mode**: Always dark mode for better user experience
4. **Accessibility**: High contrast ratios for better readability
5. **Responsive**: Consistent spacing and sizing across breakpoints

## CSS Modules

All component styles use CSS Modules to prevent naming conflicts and provide better organization:

- **Component styles**: `src/styles/components/`
- **Page styles**: `src/styles/pages/`
- **Shared styles**: `src/styles/shared/`

## Usage

### Importing Styles

```tsx
import styles from '../styles/components/ComponentName.module.css';

// Use in JSX
<div className={styles.container}>
    <h1 className={styles.title}>Title</h1>
</div>
```

### Adding New Components

1. Create a new CSS module in the appropriate folder
2. Use the theme variables for colors, spacing, and other values
3. Import and use in your component

### Adding New Pages

1. Create a new CSS module in `src/styles/pages/`
2. Follow the existing naming conventions
3. Use the theme system for consistent styling

## Responsive Design

All components include responsive breakpoints:

- **Mobile**: `max-width: 480px`
- **Tablet**: `max-width: 768px`
- **Desktop**: Default styles

## Best Practices

1. **Always use theme variables** instead of hardcoded values
2. **Follow the existing naming conventions** for CSS classes
3. **Include responsive styles** for all components
4. **Use semantic class names** that describe the purpose
5. **Keep components focused** on their specific styling needs
6. **Test on multiple screen sizes** to ensure responsiveness

## Theme Customization

To modify the theme:

1. Edit `src/styles/shared/theme.css`
2. Update the CSS custom properties
3. All components will automatically use the new values

## Adding New Theme Variables

When adding new theme variables:

1. Add them to the `:root` selector in `theme.css`
2. Use descriptive names that indicate their purpose
3. Group related variables together
4. Document any new variables in this README

## Performance

- CSS Modules provide scoped styling without conflicts
- Theme variables are efficient and don't impact performance
- Minimal CSS is loaded per component
- Responsive design uses efficient media queries
