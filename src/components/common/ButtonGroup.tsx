import React from "react";

type ButtonGroupSize = "tight" | "default" | "spaced";
type ButtonGroupAlign = "stretch" | "start" | "end" | "center";
type ButtonGroupStack = "never" | "mobile" | "always";

export function ButtonGroup({
  children,
  size = "default",
  align = "stretch",
  stack = "never",
  className,
  style,
  as: Tag = "div",
  role,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  size?: ButtonGroupSize;
  align?: ButtonGroupAlign;
  stack?: ButtonGroupStack;
  className?: string;
  style?: React.CSSProperties;
  as?: "div" | "nav";
  role?: string;
  "aria-label"?: string;
}) {
  const classes = ["btngroup", `btngroup-${size}`, `btngroup-align-${align}`];
  if (stack !== "never") classes.push(`btngroup-stack-${stack}`);
  if (className) classes.push(className);
  return (
    <Tag className={classes.join(" ")} style={style} role={role} aria-label={ariaLabel}>
      {children}
    </Tag>
  );
}
