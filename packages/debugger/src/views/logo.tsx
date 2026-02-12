/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";

/**
 * Props for the {@link FedifyLogo} component.
 */
export interface FedifyLogoProps {
  /**
   * The width and height of the logo in pixels.
   * @default 24
   */
  size?: number;
}

/**
 * Inline SVG of the Fedify logo (mascot bird with fediverse connection nodes).
 */
export const FedifyLogo: FC<FedifyLogoProps> = ({ size = 24 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 112 112"
      role="img"
      aria-label="Fedify logo"
    >
      <defs>
        <clipPath
          clipPathUnits="userSpaceOnUse"
          id="fedify-logo-clip"
        >
          <ellipse
            style="fill: #000; stroke: #000; stroke-width: 3.02635; stroke-linejoin: miter; stroke-dasharray: none; stroke-dashoffset: 0; stroke-opacity: 1; paint-order: normal"
            cx="55.92646"
            cy="56.073448"
            transform="rotate(-0.07519647)"
            rx="54.486828"
            ry="54.486824"
          />
        </clipPath>
      </defs>
      <ellipse
        style="fill: #ffffff; stroke: none; stroke-width: 3.02635; stroke-linejoin: miter; stroke-dasharray: none; stroke-dashoffset: 0; stroke-opacity: 1; paint-order: normal"
        cx="55.92646"
        cy="56.073448"
        transform="rotate(-0.07519647)"
        rx="54.486828"
        ry="54.486824"
      />
      <g clip-path="url(#fedify-logo-clip)">
        <g>
          <path
            d="M 77.4624,78.9593 C 78.2802,68.3428 73.7143,58.8833 71.3291,55.4806 L 87.6847,48.335 c 4.9066,1.6333 6.474,17.3537 6.6444,25.0098 0,0 -3.5778,0.5104 -5.6222,2.0416 -2.085,1.5616 -5.6222,5.1041 -11.2445,3.5729 z"
            fill="#ffffff"
            stroke="#84b5d9"
            stroke-width="3"
            stroke-linecap="round"
          />
          <path
            d="M 7.06239,52.159 C -5.55748,54.1782 -12.682,66.0659 -17.661,73.2769 c -0.8584,13.3918 -0.6181,41.1021 7.211,44.8111 7.82906,3.709 26.9553,1.545 35.5398,0 v 4.121 c 1.3736,0.515 5.0477,1.648 8.7562,2.06 3.7085,0.412 6.696,-1.202 7.7261,-2.06 v -9.787 c 0.5151,-0.343 2.9874,-1.957 8.7562,-5.666 7.211,-4.635 11.3315,-16.482 9.7863,-24.7229 -1.1589,-6.181 3.6055,-18.5427 6.1809,-26.7838 9.7863,2.0601 22.148,-1.0301 23.1781,-14.9369 C 90.1205,31.5801 80.7174,19.9868 63.2051,25.3752 45.6927,30.7636 48.268,52.159 41.5721,59.37 35.3913,53.1891 23.5446,49.5219 7.06239,52.159 Z"
            fill="#bae6fd"
            stroke="#0c4a6e"
            stroke-width="3"
            stroke-linecap="round"
          />
          <path
            d="M 66.2955,55.2493 C 64.5786,54.7342 60.9387,53.6011 60.1146,53.189"
            stroke="#0284c7"
            stroke-opacity="0.37"
            stroke-width="3"
            stroke-linecap="round"
            style="opacity: 1; fill: none; stroke-width: 3; stroke-linejoin: miter; stroke-dasharray: none; paint-order: normal"
          />
          <path
            d="m 41.5721,59.3698 c -0.6868,0.8585 -2.6784,2.7814 -5.1507,3.6055"
            stroke="#0284c7"
            stroke-opacity="0.37"
            stroke-width="3"
            stroke-linecap="round"
            style="fill: none"
          />
          <circle
            cx="68.870796"
            cy="42.8876"
            r="2.0602801"
            fill="#000000"
          />
        </g>
        <g
          transform="matrix(0.08160718,0,0,0.08160718,76.994732,53.205469)"
          style="display: inline"
        >
          <path
            style="fill: #a730b8; fill-opacity: 1; fill-rule: nonzero; stroke: none; stroke-width: 41.5748"
            d="m 181.13086,275.13672 a 68.892408,68.892408 0 0 1 -29.46484,29.32812 l 161.75781,162.38868 38.99805,-19.76368 z m 213.36328,214.1875 -38.99805,19.76367 81.96289,82.2832 a 68.892409,68.892409 0 0 1 29.47071,-29.33203 z"
            transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
          />
          <path
            style="fill: #5496be; fill-opacity: 1; fill-rule: nonzero; stroke: none; stroke-width: 41.5748"
            d="m 581.64648,339.39062 -91.57617,46.41016 6.75196,43.18945 103.61523,-52.51367 A 68.892409,68.892409 0 0 1 581.64648,339.39062 Z M 436.9082,412.74219 220.38281,522.47656 a 68.892408,68.892408 0 0 1 18.79492,37.08985 L 443.66016,455.93359 Z"
            transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
          />
          <path
            style="fill: #ce3d1a; fill-opacity: 1; fill-rule: nonzero; stroke: none; stroke-width: 41.5748"
            d="M 367.27539,142.4375 262.79492,346.4082 293.64258,377.375 404.26562,161.41797 A 68.892408,68.892408 0 0 1 367.27539,142.4375 Z m -131.6543,257.02148 -52.92187,103.31446 a 68.892409,68.892409 0 0 1 36.98633,18.97851 l 46.78125,-91.32812 z"
            transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
          />
          <path
            style="fill: #d0188f; fill-opacity: 1; fill-rule: nonzero; stroke: none; stroke-width: 41.5748"
            d="m 150.76758,304.91797 a 68.892408,68.892408 0 0 1 -34.41602,7.19531 68.892408,68.892408 0 0 1 -6.65039,-0.69531 l 30.90235,197.66211 a 68.892409,68.892409 0 0 1 34.41601,-7.19531 68.892409,68.892409 0 0 1 6.64649,0.69531 z"
            transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
          />
          <path
            style="fill: #5b36e9; fill-opacity: 1; fill-rule: nonzero; stroke: none; stroke-width: 41.5748"
            d="m 239.3418,560.54492 a 68.892408,68.892408 0 0 1 0.7207,13.87696 68.892408,68.892408 0 0 1 -7.26758,27.17968 l 197.62891,31.71289 a 68.892409,68.892409 0 0 1 -0.72266,-13.8789 68.892409,68.892409 0 0 1 7.26953,-27.17774 z"
            transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
          />
          <path
            style="fill: #30b873; fill-opacity: 1; fill-rule: nonzero; stroke: none; stroke-width: 41.5748"
            d="m 601.13281,377.19922 -91.21875,178.08203 a 68.892408,68.892408 0 0 1 36.99414,18.98242 L 638.125,396.18359 a 68.892409,68.892409 0 0 1 -36.99219,-18.98437 z"
            transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
          />
          <path
            style="fill: #ebe305; fill-opacity: 1; fill-rule: nonzero; stroke: none; stroke-width: 41.5748"
            d="m 476.72266,125.33008 a 68.892408,68.892408 0 0 1 -29.47071,29.33203 l 141.26563,141.81055 a 68.892409,68.892409 0 0 1 29.46875,-29.33204 z"
            transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
          />
          <path
            style="fill: #f47601; fill-opacity: 1; fill-rule: nonzero; stroke: none; stroke-width: 41.5748"
            d="m 347.78711,104.63086 -178.57617,90.49805 a 68.892409,68.892409 0 0 1 18.79297,37.08593 l 178.57421,-90.50195 a 68.892408,68.892408 0 0 1 -18.79101,-37.08203 z"
            transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
          />
          <path
            style="fill: #57c115; fill-opacity: 1; fill-rule: nonzero; stroke: none; stroke-width: 41.5748"
            d="m 446.92578,154.82617 a 68.892408,68.892408 0 0 1 -34.98242,7.48242 68.892408,68.892408 0 0 1 -6.0293,-0.63281 l 15.81836,101.29102 43.16211,6.92578 z m -16,167.02735 37.40039,239.48242 a 68.892409,68.892409 0 0 1 33.91406,-6.94336 68.892409,68.892409 0 0 1 7.20704,0.79101 L 474.08984,328.77734 Z"
            transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
          />
          <path
            style="fill: #dbb210; fill-opacity: 1; fill-rule: nonzero; stroke: none; stroke-width: 41.5748"
            d="m 188.13086,232.97461 a 68.892408,68.892408 0 0 1 0.75781,14.0957 68.892408,68.892408 0 0 1 -7.16015,26.98242 l 101.36914,16.28125 19.92382,-38.9082 z m 173.73633,27.90039 -19.92578,38.91211 239.51367,38.4668 a 68.892409,68.892409 0 0 1 -0.69531,-13.71875 68.892409,68.892409 0 0 1 7.34961,-27.32422 z"
            transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
          />
          <circle
            style="fill: #ffca00; fill-opacity: 0.995968; stroke: none; stroke-width: 0.264583; stroke-opacity: 0.960784"
            cx="106.26596"
            cy="51.535553"
            r="16.570711"
            transform="rotate(3.1178174)"
          />
          <circle
            style="fill: #64ff00; fill-opacity: 0.995968; stroke: none; stroke-width: 0.264583; stroke-opacity: 0.960784"
            cx="171.42836"
            cy="110.19328"
            r="16.570711"
            transform="rotate(3.1178174)"
          />
          <circle
            style="fill: #00a3ff; fill-opacity: 0.995968; stroke: none; stroke-width: 0.264583; stroke-opacity: 0.960784"
            cx="135.76379"
            cy="190.27704"
            r="16.570711"
            transform="rotate(3.1178174)"
          />
          <circle
            style="fill: #9500ff; fill-opacity: 0.995968; stroke: none; stroke-width: 0.264583; stroke-opacity: 0.960784"
            cx="48.559471"
            cy="181.1138"
            r="16.570711"
            transform="rotate(3.1178174)"
          />
          <circle
            style="fill: #ff0000; fill-opacity: 0.995968; stroke: none; stroke-width: 0.264583; stroke-opacity: 0.960784"
            cx="30.328812"
            cy="95.366837"
            r="16.570711"
            transform="rotate(3.1178174)"
          />
        </g>
      </g>
      <circle
        style="opacity: 1; fill: none; stroke: #84b5d9; stroke-width: 4.91342; stroke-linejoin: miter; stroke-dasharray: none; stroke-dashoffset: 0; stroke-opacity: 1; paint-order: normal"
        cx="55.926456"
        cy="56.073448"
        transform="rotate(-0.07519625)"
        r="53.543289"
      />
    </svg>
  );
};
