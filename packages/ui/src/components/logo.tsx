import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(0 2) scale(0.1666667)">
        <rect x="4" y="4" width="88" height="88" rx="24" fill="#C46D42" />
        <path d="M29 28H40V46.5L57.5 28H71L52 48L72 68H58L40 49.5V68H29V28Z" fill="#FFF6EA" />
        <rect x="64" y="14" width="18" height="7" rx="3.5" fill="#2E221A" />
      </g>
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(8 18) scale(0.6666667)">
        <rect x="4" y="4" width="88" height="88" rx="24" fill="#C46D42" />
        <path d="M29 28H40V46.5L57.5 28H71L52 48L72 68H58L40 49.5V68H29V28Z" fill="#FFF6EA" />
        <rect x="64" y="14" width="18" height="7" rx="3.5" fill="#2E221A" />
      </g>
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 226 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g transform="scale(0.4375)">
        <rect x="4" y="4" width="88" height="88" rx="24" fill="#C46D42" />
        <path d="M29 28H40V46.5L57.5 28H71L52 48L72 68H58L40 49.5V68H29V28Z" fill="#FFF6EA" />
        <rect x="64" y="14" width="18" height="7" rx="3.5" fill="#2E221A" />
      </g>
      <text
        x="52"
        y="29"
        fill="var(--icon-strong-base)"
        font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        font-size="24"
        font-weight="700"
        letter-spacing="-0.04em"
      >
        KiCode
      </text>
    </svg>
  )
}
