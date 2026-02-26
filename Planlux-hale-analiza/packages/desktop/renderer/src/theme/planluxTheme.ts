/**
 * PLANLUX UI Theme – MUI v7, design system premium B2B.
 */

import { createTheme } from "@mui/material/styles";
import { tokens } from "./tokens";

export const planluxTheme = createTheme({
  palette: {
    primary: {
      main: tokens.color.primary,
      light: tokens.color.primaryHover,
      dark: "#6B1E2A",
      contrastText: tokens.color.white,
    },
    secondary: {
      main: tokens.color.navy,
      light: tokens.color.navyLight,
      contrastText: tokens.color.white,
    },
    success: { main: tokens.color.success },
    warning: { main: tokens.color.warning },
    error: { main: tokens.color.error },
    background: {
      default: tokens.color.gray[50],
      paper: tokens.color.white,
    },
    text: {
      primary: tokens.color.text,
      secondary: tokens.color.textMuted,
    },
  },
  typography: {
    fontFamily: tokens.font.family,
    h1: { fontWeight: tokens.font.weight.bold, fontSize: tokens.font.size["2xl"] },
    h2: { fontWeight: tokens.font.weight.semiBold, fontSize: tokens.font.size.xl },
    h3: { fontWeight: tokens.font.weight.semiBold, fontSize: tokens.font.size.lg },
    h4: { fontWeight: tokens.font.weight.semiBold, fontSize: tokens.font.size.base },
    h5: { fontWeight: tokens.font.weight.semiBold, fontSize: tokens.font.size.lg },
    h6: { fontWeight: tokens.font.weight.medium, fontSize: tokens.font.size.base },
    body1: { fontSize: tokens.font.size.base },
    body2: { fontSize: tokens.font.size.sm },
    caption: { fontSize: tokens.font.size.xs, color: tokens.color.textMuted },
    button: { fontWeight: tokens.font.weight.medium, textTransform: "none" as const },
  },
  shape: {
    borderRadius: tokens.radius.lg,
  },
  spacing: 8,
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.md,
          textTransform: "none",
          fontWeight: tokens.font.weight.medium,
        },
        contained: {
          boxShadow: tokens.shadow.sm,
          "&:hover": {
            boxShadow: tokens.shadow.md,
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.lg,
          boxShadow: tokens.shadow.md,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.lg,
          boxShadow: tokens.shadow.md,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.md,
          fontWeight: tokens.font.weight.medium,
        },
      },
    },
    MuiTable: {
      styleOverrides: {
        root: {
          "& .MuiTableHead-root": {
            backgroundColor: tokens.color.gray[50],
          },
          "& .MuiTableRow-root:hover": {
            backgroundColor: tokens.color.navyMuted,
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: "12px 16px",
          fontSize: tokens.font.size.sm,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: tokens.radius.lg,
          padding: tokens.space[4],
        },
      },
    },
  },
});
