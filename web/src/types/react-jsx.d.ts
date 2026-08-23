import * as React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: unknown;
    }
  }
}

declare module "react/jsx-runtime" {
  export const JSX: typeof React;
}
