/** @jsx react-jsx */
/** @jsxImportSource hono/jsx */
import type { LogRecord } from "@logtape/logtape";
import { getStatusText } from "@poppanator/http-constants";
import { type FC, Fragment, type PropsWithChildren } from "hono/jsx";
import { getSingletonHighlighter } from "shiki";
import type { ActivityEntry } from "./entry.ts";
import {
  renderActivity,
  renderRawActivity,
  renderRequest,
  renderResponse,
} from "./rendercode.ts";

interface LayoutProps {
  title?: string;
  handle: string;
}

const Layout: FC<PropsWithChildren<LayoutProps>> = (
  props: PropsWithChildren<LayoutProps>,
) => {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>
          {props.title == null
            ? ""
            // deno-lint-ignore jsx-curly-braces
            : <Fragment>{props.title} &mdash;{" "}</Fragment>}Fedify Ephemeral
          Inbox ({props.handle})
        </title>
        <link
          href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
          rel="stylesheet"
          integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH"
          crossorigin="anonymous"
        />
      </head>
      <body>
        <header class="container mt-3 mb-3 text-center">
          <svg
            width="48"
            height="48"
            viewBox="0 0 112 112"
            version="1.1"
            id="svg5"
            xmlns="http://www.w3.org/2000/svg"
            xmlns:svg="http://www.w3.org/2000/svg"
            xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
            xmlns:cc="http://creativecommons.org/ns#"
            xmlns:dc="http://purl.org/dc/elements/1.1/"
          >
            <defs id="defs5">
              <clipPath
                clipPathUnits="userSpaceOnUse"
                id="clipPath8"
              >
                <ellipse
                  style="fill:#000000;stroke:#000000;stroke-width:3.02635;stroke-linejoin:miter;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;paint-order:normal"
                  id="ellipse8"
                  cx="55.92646"
                  cy="56.073448"
                  transform="rotate(-0.07519647)"
                  rx="54.486828"
                  ry="54.486824"
                />
              </clipPath>
            </defs>
            <title id="title1">Fedify</title>
            <ellipse
              style="fill:#ffffff;stroke:none;stroke-width:3.02635;stroke-linejoin:miter;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;paint-order:normal"
              id="path8-2"
              cx="55.92646"
              cy="56.073448"
              transform="rotate(-0.07519647)"
              rx="54.486828"
              ry="54.486824"
            />
            <g
              id="g8"
              clip-path="url(#clipPath8)"
            >
              <g id="g5">
                <path
                  d="M 77.4624,78.9593 C 78.2802,68.3428 73.7143,58.8833 71.3291,55.4806 L 87.6847,48.335 c 4.9066,1.6333 6.474,17.3537 6.6444,25.0098 0,0 -3.5778,0.5104 -5.6222,2.0416 -2.085,1.5616 -5.6222,5.1041 -11.2445,3.5729 z"
                  fill="#ffffff"
                  stroke="#84b5d9"
                  stroke-width="3"
                  stroke-linecap="round"
                  id="path1"
                />
                <path
                  d="M 7.06239,52.159 C -5.55748,54.1782 -12.682,66.0659 -17.661,73.2769 c -0.8584,13.3918 -0.6181,41.1021 7.211,44.8111 7.82906,3.709 26.9553,1.545 35.5398,0 v 4.121 c 1.3736,0.515 5.0477,1.648 8.7562,2.06 3.7085,0.412 6.696,-1.202 7.7261,-2.06 v -9.787 c 0.5151,-0.343 2.9874,-1.957 8.7562,-5.666 7.211,-4.635 11.3315,-16.482 9.7863,-24.7229 -1.1589,-6.181 3.6055,-18.5427 6.1809,-26.7838 9.7863,2.0601 22.148,-1.0301 23.1781,-14.9369 C 90.1205,31.5801 80.7174,19.9868 63.2051,25.3752 45.6927,30.7636 48.268,52.159 41.5721,59.37 35.3913,53.1891 23.5446,49.5219 7.06239,52.159 Z"
                  fill="#bae6fd"
                  stroke="#0c4a6e"
                  stroke-width="3"
                  stroke-linecap="round"
                  id="path3"
                />
                <path
                  d="M 66.2955,55.2493 C 64.5786,54.7342 60.9387,53.6011 60.1146,53.189"
                  stroke="#0284c7"
                  stroke-opacity="0.37"
                  stroke-width="3"
                  stroke-linecap="round"
                  id="path4"
                  style="opacity:1;fill:none;stroke-width:3;stroke-linejoin:miter;stroke-dasharray:none;paint-order:normal"
                />
                <path
                  d="m 41.5721,59.3698 c -0.6868,0.8585 -2.6784,2.7814 -5.1507,3.6055"
                  stroke="#0284c7"
                  stroke-opacity="0.37"
                  stroke-width="3"
                  stroke-linecap="round"
                  id="path5"
                  style="fill:none"
                />
                <circle
                  cx="68.870796"
                  cy="42.8876"
                  r="2.0602801"
                  fill="#000000"
                  id="circle5"
                />
              </g>
              <g
                id="g2"
                transform="matrix(0.08160718,0,0,0.08160718,76.994732,53.205469)"
                style="display:inline"
              >
                <path
                  style="color:#000000;font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:medium;line-height:normal;font-family:sans-serif;font-variant-ligatures:normal;font-variant-position:normal;font-variant-caps:normal;font-variant-numeric:normal;font-variant-alternates:normal;font-feature-settings:normal;text-indent:0;text-align:start;text-decoration:none;text-decoration-line:none;text-decoration-style:solid;text-decoration-color:#000000;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:lr-tb;direction:ltr;text-orientation:mixed;dominant-baseline:auto;baseline-shift:baseline;text-anchor:start;white-space:normal;shape-padding:0;clip-rule:nonzero;display:inline;overflow:visible;visibility:visible;opacity:1;isolation:auto;mix-blend-mode:normal;color-interpolation:sRGB;color-interpolation-filters:linearRGB;solid-color:#000000;solid-opacity:1;vector-effect:none;fill:#a730b8;fill-opacity:1;fill-rule:nonzero;stroke:none;stroke-width:41.5748;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;color-rendering:auto;image-rendering:auto;shape-rendering:auto;text-rendering:auto;enable-background:accumulate"
                  d="m 181.13086,275.13672 a 68.892408,68.892408 0 0 1 -29.46484,29.32812 l 161.75781,162.38868 38.99805,-19.76368 z m 213.36328,214.1875 -38.99805,19.76367 81.96289,82.2832 a 68.892409,68.892409 0 0 1 29.47071,-29.33203 z"
                  id="path9722"
                  transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
                />
                <path
                  style="color:#000000;font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:medium;line-height:normal;font-family:sans-serif;font-variant-ligatures:normal;font-variant-position:normal;font-variant-caps:normal;font-variant-numeric:normal;font-variant-alternates:normal;font-feature-settings:normal;text-indent:0;text-align:start;text-decoration:none;text-decoration-line:none;text-decoration-style:solid;text-decoration-color:#000000;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:lr-tb;direction:ltr;text-orientation:mixed;dominant-baseline:auto;baseline-shift:baseline;text-anchor:start;white-space:normal;shape-padding:0;clip-rule:nonzero;display:inline;overflow:visible;visibility:visible;opacity:1;isolation:auto;mix-blend-mode:normal;color-interpolation:sRGB;color-interpolation-filters:linearRGB;solid-color:#000000;solid-opacity:1;vector-effect:none;fill:#5496be;fill-opacity:1;fill-rule:nonzero;stroke:none;stroke-width:41.5748;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;color-rendering:auto;image-rendering:auto;shape-rendering:auto;text-rendering:auto;enable-background:accumulate"
                  d="m 581.64648,339.39062 -91.57617,46.41016 6.75196,43.18945 103.61523,-52.51367 A 68.892409,68.892409 0 0 1 581.64648,339.39062 Z M 436.9082,412.74219 220.38281,522.47656 a 68.892408,68.892408 0 0 1 18.79492,37.08985 L 443.66016,455.93359 Z"
                  id="path9729"
                  transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
                />
                <path
                  style="color:#000000;font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:medium;line-height:normal;font-family:sans-serif;font-variant-ligatures:normal;font-variant-position:normal;font-variant-caps:normal;font-variant-numeric:normal;font-variant-alternates:normal;font-feature-settings:normal;text-indent:0;text-align:start;text-decoration:none;text-decoration-line:none;text-decoration-style:solid;text-decoration-color:#000000;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:lr-tb;direction:ltr;text-orientation:mixed;dominant-baseline:auto;baseline-shift:baseline;text-anchor:start;white-space:normal;shape-padding:0;clip-rule:nonzero;display:inline;overflow:visible;visibility:visible;opacity:1;isolation:auto;mix-blend-mode:normal;color-interpolation:sRGB;color-interpolation-filters:linearRGB;solid-color:#000000;solid-opacity:1;vector-effect:none;fill:#ce3d1a;fill-opacity:1;fill-rule:nonzero;stroke:none;stroke-width:41.5748;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;color-rendering:auto;image-rendering:auto;shape-rendering:auto;text-rendering:auto;enable-background:accumulate"
                  d="M 367.27539,142.4375 262.79492,346.4082 293.64258,377.375 404.26562,161.41797 A 68.892408,68.892408 0 0 1 367.27539,142.4375 Z m -131.6543,257.02148 -52.92187,103.31446 a 68.892409,68.892409 0 0 1 36.98633,18.97851 l 46.78125,-91.32812 z"
                  id="path9713"
                  transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
                />
                <path
                  style="color:#000000;font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:medium;line-height:normal;font-family:sans-serif;font-variant-ligatures:normal;font-variant-position:normal;font-variant-caps:normal;font-variant-numeric:normal;font-variant-alternates:normal;font-feature-settings:normal;text-indent:0;text-align:start;text-decoration:none;text-decoration-line:none;text-decoration-style:solid;text-decoration-color:#000000;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:lr-tb;direction:ltr;text-orientation:mixed;dominant-baseline:auto;baseline-shift:baseline;text-anchor:start;white-space:normal;shape-padding:0;clip-rule:nonzero;display:inline;overflow:visible;visibility:visible;opacity:1;isolation:auto;mix-blend-mode:normal;color-interpolation:sRGB;color-interpolation-filters:linearRGB;solid-color:#000000;solid-opacity:1;vector-effect:none;fill:#d0188f;fill-opacity:1;fill-rule:nonzero;stroke:none;stroke-width:41.5748;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;color-rendering:auto;image-rendering:auto;shape-rendering:auto;text-rendering:auto;enable-background:accumulate"
                  d="m 150.76758,304.91797 a 68.892408,68.892408 0 0 1 -34.41602,7.19531 68.892408,68.892408 0 0 1 -6.65039,-0.69531 l 30.90235,197.66211 a 68.892409,68.892409 0 0 1 34.41601,-7.19531 68.892409,68.892409 0 0 1 6.64649,0.69531 z"
                  id="path1015"
                  transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
                />
                <path
                  style="color:#000000;font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:medium;line-height:normal;font-family:sans-serif;font-variant-ligatures:normal;font-variant-position:normal;font-variant-caps:normal;font-variant-numeric:normal;font-variant-alternates:normal;font-feature-settings:normal;text-indent:0;text-align:start;text-decoration:none;text-decoration-line:none;text-decoration-style:solid;text-decoration-color:#000000;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:lr-tb;direction:ltr;text-orientation:mixed;dominant-baseline:auto;baseline-shift:baseline;text-anchor:start;white-space:normal;shape-padding:0;clip-rule:nonzero;display:inline;overflow:visible;visibility:visible;opacity:1;isolation:auto;mix-blend-mode:normal;color-interpolation:sRGB;color-interpolation-filters:linearRGB;solid-color:#000000;solid-opacity:1;vector-effect:none;fill:#5b36e9;fill-opacity:1;fill-rule:nonzero;stroke:none;stroke-width:41.5748;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;color-rendering:auto;image-rendering:auto;shape-rendering:auto;text-rendering:auto;enable-background:accumulate"
                  d="m 239.3418,560.54492 a 68.892408,68.892408 0 0 1 0.7207,13.87696 68.892408,68.892408 0 0 1 -7.26758,27.17968 l 197.62891,31.71289 a 68.892409,68.892409 0 0 1 -0.72266,-13.8789 68.892409,68.892409 0 0 1 7.26953,-27.17774 z"
                  id="path1674"
                  transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
                />
                <path
                  style="color:#000000;font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:medium;line-height:normal;font-family:sans-serif;font-variant-ligatures:normal;font-variant-position:normal;font-variant-caps:normal;font-variant-numeric:normal;font-variant-alternates:normal;font-feature-settings:normal;text-indent:0;text-align:start;text-decoration:none;text-decoration-line:none;text-decoration-style:solid;text-decoration-color:#000000;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:lr-tb;direction:ltr;text-orientation:mixed;dominant-baseline:auto;baseline-shift:baseline;text-anchor:start;white-space:normal;shape-padding:0;clip-rule:nonzero;display:inline;overflow:visible;visibility:visible;opacity:1;isolation:auto;mix-blend-mode:normal;color-interpolation:sRGB;color-interpolation-filters:linearRGB;solid-color:#000000;solid-opacity:1;vector-effect:none;fill:#30b873;fill-opacity:1;fill-rule:nonzero;stroke:none;stroke-width:41.5748;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;color-rendering:auto;image-rendering:auto;shape-rendering:auto;text-rendering:auto;enable-background:accumulate"
                  d="m 601.13281,377.19922 -91.21875,178.08203 a 68.892408,68.892408 0 0 1 36.99414,18.98242 L 638.125,396.18359 a 68.892409,68.892409 0 0 1 -36.99219,-18.98437 z"
                  id="path1676"
                  transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
                />
                <path
                  style="color:#000000;font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:medium;line-height:normal;font-family:sans-serif;font-variant-ligatures:normal;font-variant-position:normal;font-variant-caps:normal;font-variant-numeric:normal;font-variant-alternates:normal;font-feature-settings:normal;text-indent:0;text-align:start;text-decoration:none;text-decoration-line:none;text-decoration-style:solid;text-decoration-color:#000000;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:lr-tb;direction:ltr;text-orientation:mixed;dominant-baseline:auto;baseline-shift:baseline;text-anchor:start;white-space:normal;shape-padding:0;clip-rule:nonzero;display:inline;overflow:visible;visibility:visible;opacity:1;isolation:auto;mix-blend-mode:normal;color-interpolation:sRGB;color-interpolation-filters:linearRGB;solid-color:#000000;solid-opacity:1;vector-effect:none;fill:#ebe305;fill-opacity:1;fill-rule:nonzero;stroke:none;stroke-width:41.5748;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;color-rendering:auto;image-rendering:auto;shape-rendering:auto;text-rendering:auto;enable-background:accumulate"
                  d="m 476.72266,125.33008 a 68.892408,68.892408 0 0 1 -29.47071,29.33203 l 141.26563,141.81055 a 68.892409,68.892409 0 0 1 29.46875,-29.33204 z"
                  id="path1678"
                  transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
                />
                <path
                  style="color:#000000;font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:medium;line-height:normal;font-family:sans-serif;font-variant-ligatures:normal;font-variant-position:normal;font-variant-caps:normal;font-variant-numeric:normal;font-variant-alternates:normal;font-feature-settings:normal;text-indent:0;text-align:start;text-decoration:none;text-decoration-line:none;text-decoration-style:solid;text-decoration-color:#000000;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:lr-tb;direction:ltr;text-orientation:mixed;dominant-baseline:auto;baseline-shift:baseline;text-anchor:start;white-space:normal;shape-padding:0;clip-rule:nonzero;display:inline;overflow:visible;visibility:visible;opacity:1;isolation:auto;mix-blend-mode:normal;color-interpolation:sRGB;color-interpolation-filters:linearRGB;solid-color:#000000;solid-opacity:1;vector-effect:none;fill:#f47601;fill-opacity:1;fill-rule:nonzero;stroke:none;stroke-width:41.5748;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;color-rendering:auto;image-rendering:auto;shape-rendering:auto;text-rendering:auto;enable-background:accumulate"
                  d="m 347.78711,104.63086 -178.57617,90.49805 a 68.892409,68.892409 0 0 1 18.79297,37.08593 l 178.57421,-90.50195 a 68.892408,68.892408 0 0 1 -18.79101,-37.08203 z"
                  id="path1680"
                  transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
                />
                <path
                  style="color:#000000;font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:medium;line-height:normal;font-family:sans-serif;font-variant-ligatures:normal;font-variant-position:normal;font-variant-caps:normal;font-variant-numeric:normal;font-variant-alternates:normal;font-feature-settings:normal;text-indent:0;text-align:start;text-decoration:none;text-decoration-line:none;text-decoration-style:solid;text-decoration-color:#000000;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:lr-tb;direction:ltr;text-orientation:mixed;dominant-baseline:auto;baseline-shift:baseline;text-anchor:start;white-space:normal;shape-padding:0;clip-rule:nonzero;display:inline;overflow:visible;visibility:visible;opacity:1;isolation:auto;mix-blend-mode:normal;color-interpolation:sRGB;color-interpolation-filters:linearRGB;solid-color:#000000;solid-opacity:1;vector-effect:none;fill:#57c115;fill-opacity:1;fill-rule:nonzero;stroke:none;stroke-width:41.5748;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;color-rendering:auto;image-rendering:auto;shape-rendering:auto;text-rendering:auto;enable-background:accumulate"
                  d="m 446.92578,154.82617 a 68.892408,68.892408 0 0 1 -34.98242,7.48242 68.892408,68.892408 0 0 1 -6.0293,-0.63281 l 15.81836,101.29102 43.16211,6.92578 z m -16,167.02735 37.40039,239.48242 a 68.892409,68.892409 0 0 1 33.91406,-6.94336 68.892409,68.892409 0 0 1 7.20704,0.79101 L 474.08984,328.77734 Z"
                  id="path9758"
                  transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
                />
                <path
                  style="color:#000000;font-style:normal;font-variant:normal;font-weight:normal;font-stretch:normal;font-size:medium;line-height:normal;font-family:sans-serif;font-variant-ligatures:normal;font-variant-position:normal;font-variant-caps:normal;font-variant-numeric:normal;font-variant-alternates:normal;font-feature-settings:normal;text-indent:0;text-align:start;text-decoration:none;text-decoration-line:none;text-decoration-style:solid;text-decoration-color:#000000;letter-spacing:normal;word-spacing:normal;text-transform:none;writing-mode:lr-tb;direction:ltr;text-orientation:mixed;dominant-baseline:auto;baseline-shift:baseline;text-anchor:start;white-space:normal;shape-padding:0;clip-rule:nonzero;display:inline;overflow:visible;visibility:visible;opacity:1;isolation:auto;mix-blend-mode:normal;color-interpolation:sRGB;color-interpolation-filters:linearRGB;solid-color:#000000;solid-opacity:1;vector-effect:none;fill:#dbb210;fill-opacity:1;fill-rule:nonzero;stroke:none;stroke-width:41.5748;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;color-rendering:auto;image-rendering:auto;shape-rendering:auto;text-rendering:auto;enable-background:accumulate"
                  d="m 188.13086,232.97461 a 68.892408,68.892408 0 0 1 0.75781,14.0957 68.892408,68.892408 0 0 1 -7.16015,26.98242 l 101.36914,16.28125 19.92382,-38.9082 z m 173.73633,27.90039 -19.92578,38.91211 239.51367,38.4668 a 68.892409,68.892409 0 0 1 -0.69531,-13.71875 68.892409,68.892409 0 0 1 7.34961,-27.32422 z"
                  id="path9760"
                  transform="matrix(0.26458333,0,0,0.26458333,-6.6789703,32.495842)"
                />
                <circle
                  style="fill:#ffca00;fill-opacity:0.995968;stroke:none;stroke-width:0.264583;stroke-opacity:0.960784"
                  id="path817"
                  cx="106.26596"
                  cy="51.535553"
                  r="16.570711"
                  transform="rotate(3.1178174)"
                />
                <circle
                  id="path819"
                  style="fill:#64ff00;fill-opacity:0.995968;stroke:none;stroke-width:0.264583;stroke-opacity:0.960784"
                  cx="171.42836"
                  cy="110.19328"
                  r="16.570711"
                  transform="rotate(3.1178174)"
                />
                <circle
                  id="path823"
                  style="fill:#00a3ff;fill-opacity:0.995968;stroke:none;stroke-width:0.264583;stroke-opacity:0.960784"
                  cx="135.76379"
                  cy="190.27704"
                  r="16.570711"
                  transform="rotate(3.1178174)"
                />
                <circle
                  style="fill:#9500ff;fill-opacity:0.995968;stroke:none;stroke-width:0.264583;stroke-opacity:0.960784"
                  id="path825"
                  cx="48.559471"
                  cy="181.1138"
                  r="16.570711"
                  transform="rotate(3.1178174)"
                />
                <circle
                  id="path827"
                  style="fill:#ff0000;fill-opacity:0.995968;stroke:none;stroke-width:0.264583;stroke-opacity:0.960784"
                  cx="30.328812"
                  cy="95.366837"
                  r="16.570711"
                  transform="rotate(3.1178174)"
                />
              </g>
            </g>
            <circle
              style="opacity:1;fill:none;stroke:#84b5d9;stroke-width:4.91342;stroke-linejoin:miter;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;paint-order:normal"
              id="path8"
              cx="55.926456"
              cy="56.073448"
              transform="rotate(-0.07519625)"
              r="53.543289"
            />
          </svg>

          <h1 class="h5">Fedify Ephemeral Inbox</h1>
          <p class="text-body-secondary" style="user-select: all;">
            {props.handle}
          </p>
        </header>
        <main class="container mt-3 mb-3">
          {props.children}
        </main>
      </body>
    </html>
  );
};

interface TabProps {
  active?: boolean;
  disabled?: boolean;
  label: string;
  badge?: string | number;
  href: string;
}

const Tab: FC<TabProps> = (
  { active, disabled, label, badge, href }: TabProps,
) => {
  return (
    <li class="nav-item">
      {active
        ? (
          <span class="nav-link active" style="cursor: default;">
            {label}
            {badge != null
              ? (
                <Fragment>
                  {" "}
                  <span class="badge text-bg-secondary">{badge}</span>
                </Fragment>
              )
              : undefined}
          </span>
        )
        : disabled
        ? <span class="nav-link disabled">{label}</span>
        : (
          <a class="nav-link" href={href}>
            {label}
            {badge != null
              ? (
                <Fragment>
                  {" "}
                  <span class="badge text-bg-secondary">{badge}</span>
                </Fragment>
              )
              : undefined}
          </a>
        )}
    </li>
  );
};

// deno-lint-ignore no-empty-interface
interface TabListProps {
}

const TabList: FC<PropsWithChildren<TabListProps>> = (
  { children }: PropsWithChildren<TabListProps>,
) => {
  return (
    <ul class="nav nav-tabs">
      {children}
    </ul>
  );
};

interface CodeBlockProps {
  language: string;
  code: string;
}

const highlighter = await getSingletonHighlighter();
await highlighter.loadTheme("github-light");
await highlighter.loadLanguage("http");
await highlighter.loadLanguage("json");

const CodeBlock: FC<CodeBlockProps> = ({ language, code }: CodeBlockProps) => {
  const result = highlighter.codeToHtml(code, {
    lang: language,
    theme: "github-light",
  });
  return <div dangerouslySetInnerHTML={{ __html: result }} class="m-3" />;
};

interface LogProps {
  log: LogRecord;
}

const Log: FC<LogProps> = (
  { log: { timestamp, category, level, message } }: LogProps,
) => {
  const listClass = level === "debug"
    ? "list-group-item-light"
    : level === "info"
    ? ""
    : level === "warning"
    ? "list-group-item-warning"
    : "list-group-item-danger";
  const time = Temporal.Instant.fromEpochMilliseconds(timestamp);
  return (
    <li class={"list-group-item " + listClass}>
      <div class="d-flex w-100 justify-content-between">
        <p class="mb-1" style="white-space: pre-wrap; word-break: break-word;">
          {message.map((m, i) =>
            i % 2 == 0 ? m : (
              <code key={i}>
                {typeof m === "string" ? m : Deno.inspect(m)}
              </code>
            )
          )}
        </p>
        <time
          class="text-body-secondary"
          datetime={time.toString()}
          style="flex-shrink: 0;"
        >
          <small>{time.toLocaleString()}</small>
        </time>
      </div>
      <small class="text-body-secondary">
        {category.map((c, i) =>
          // deno-lint-ignore jsx-curly-braces
          i < 1 ? c : <Fragment key={i.toString()}>{" "}/ {c}</Fragment>
        )}
      </small>
    </li>
  );
};

interface LogListProps {
  logs: LogRecord[];
}

const LogList: FC<LogListProps> = ({ logs }: LogListProps) => {
  return (
    <ul class="list-group mt-3">
      {logs.map((log) => <Log key={log.timestamp} log={log} />)}
    </ul>
  );
};

type ActivityEntryTabPage =
  | "request"
  | "response"
  | "raw-activity"
  | "compact-activity"
  | "expanded-activity"
  | "logs";

interface ActivityEntryViewProps {
  entry: ActivityEntry;
  tabPage: ActivityEntryTabPage;
}

const ActivityEntryView: FC<ActivityEntryViewProps> = async (
  { tabPage, entry: { activity, request, response, logs } }:
    ActivityEntryViewProps,
) => {
  return (
    <div>
      <TabList>
        <Tab
          label="Request"
          href="?tab=request"
          active={tabPage === "request"}
        />
        <Tab
          label="Response"
          href="?tab=response"
          disabled={response == null}
          active={tabPage === "response"}
        />
        <Tab
          label="Raw Activity"
          href="?tab=raw-activity"
          disabled={activity == null}
          active={tabPage === "raw-activity"}
        />
        <Tab
          label="Compact Activity"
          href="?tab=compact-activity"
          disabled={activity == null}
          active={tabPage === "compact-activity"}
        />
        <Tab
          label="Expanded Activity"
          href="?tab=expanded-activity"
          disabled={activity == null}
          active={tabPage === "expanded-activity"}
        />
        <Tab
          label="Logs"
          href="?tab=logs"
          badge={logs.length}
          active={tabPage === "logs"}
        />
      </TabList>
      {tabPage === "request" && (
        <div class="tab-page">
          <CodeBlock
            code={await renderRequest(request)}
            language="http"
          />
        </div>
      )}
      {tabPage === "response" && response != null && (
        <div class="tab-page">
          <CodeBlock
            code={await renderResponse(response)}
            language="http"
          />
        </div>
      )}
      {tabPage === "raw-activity" && (
        <div class="tab-page">
          <CodeBlock
            code={await renderRawActivity(request)}
            language="json"
          />
        </div>
      )}
      {tabPage === "compact-activity" && activity != null && (
        <div class="tab-page">
          <CodeBlock
            code={await renderActivity(activity, false)}
            language="json"
          />
        </div>
      )}
      {tabPage === "expanded-activity" && activity != null && (
        <div class="tab-page">
          <CodeBlock
            code={await renderActivity(activity, true)}
            language="json"
          />
        </div>
      )}
      {tabPage === "logs" && (
        <div class="tab-page">
          <LogList logs={logs} />
        </div>
      )}
    </div>
  );
};

export interface ActivityEntryPageProps extends ActivityEntryViewProps {
  handle: string;
  idx: number;
}

export const ActivityEntryPage: FC<ActivityEntryPageProps> = (
  { handle, idx, entry, tabPage }: ActivityEntryPageProps,
) => {
  return (
    <Layout handle={handle} title={`Request #${idx}`}>
      <nav aria-label="breadcrumb">
        <ol class="breadcrumb">
          <li class="breadcrumb-item">
            <a href="/r">Inbox</a>
          </li>
          <li class="breadcrumb-item active" aria-current="page">
            Request #{idx} (<time datetime={entry.timestamp.toString()}>
              {entry.timestamp.toLocaleString()}
            </time>)
          </li>
        </ol>
      </nav>

      <ActivityEntryView entry={entry} tabPage={tabPage} />
    </Layout>
  );
};

export interface ActivityListProps {
  entries: ActivityEntry[];
}

const ActivityList: FC<ActivityListProps> = (
  { entries }: ActivityListProps,
) => {
  return (
    <div class="list-group">
      {entries.map((entry, i) => {
        const failed = entry.activity == null || entry.response == null ||
          !entry.response.ok || entry.request.method !== "POST";
        const itemClass = failed ? "list-group-item-danger" : "";
        const url = new URL(entry.request.url);
        return (
          <a
            class={"list-group-item list-group-item-action d-flex w-100 justify-content-between " +
              itemClass}
            href={`/r/${i}`}
          >
            <span>
              Request #{i}:{" "}
              <code>{entry.request.method} {url.pathname + url.search}</code>
              {entry.activity == null ? "" : (
                <Fragment>
                  {} &middot; <code>{entry.activity.constructor.name}</code>
                </Fragment>
              )}
              {entry.response == null ? "" : (
                <Fragment>
                  {} &rarr;{" "}
                  <code>
                    {entry.response.status} {entry.response.statusText === ""
                      ? getStatusText(entry.response.status)
                      : entry.response.statusText}
                  </code>
                </Fragment>
              )}
            </span>
            <time
              class="text-body-secondary"
              timestamp={entry.timestamp.toString()}
            >
              <small>{entry.timestamp.toLocaleString()}</small>
            </time>
          </a>
        );
      }).reverse()}
    </div>
  );
};

export interface ActivityListPageProps extends ActivityListProps {
  handle: string;
}

export const ActivityListPage: FC<ActivityListPageProps> = (
  { handle, entries }: ActivityListPageProps,
) => {
  return (
    <Layout handle={handle}>
      <nav aria-label="breadcrumb">
        <ol class="breadcrumb">
          <li class="breadcrumb-item active" aria-current="page">Inbox</li>
        </ol>
      </nav>

      <ActivityList entries={entries} />
    </Layout>
  );
};
