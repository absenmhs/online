const paths={
 user:'M20 21v-2a7 7 0 0 0-14 0v2z M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
 lock:'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3',eye:'M2 12q10-15 20 0-10 15-20 0z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
 enter:'M13 3h7v18h-7 M2 12h13 M10 7l5 5-5 5',home:'m2 11 10-8 10 8 M5 10v11h5v-7h4v7h5V10',
 time:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M12 6v6l5 3', history:'M3 9a9 9 0 1 1 0 7 M2 4v6h6 M12 7v5l4 2',
 calendar:'M3 5h18v16H3z M7 3v4m10-4v4M3 10h18m-13 5 3 3 5-6',doc:'M5 2h10l4 4v16H5z M9 10h6m-6 4h6m-6 4h4',
 pin:'M19 9c0 5-7 13-7 13S5 14 5 9a7 7 0 1 1 14 0z M14 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
 wifi:'M2 8q10-9 20 0M5 12q7-6 14 0m-10 4q3-3 6 0m-3 3h.01',work:'M3 8h18v13H3z M8 8V5h8v3M3 12q9 5 18 0',
 bell:'M4 17h16l-2-4V9a6 6 0 0 0-12 0v4z M10 20q2 3 4 0',shield:'m12 2 8 4v6q-1 7-8 10-7-3-8-10V6z M12 7v6m0 3h.01',
 bars:'M3 21V11h4v10m3 0V4h4v17m3 0V8h4v13',info:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M12 11v6m0-10h.01',
 settings:'m9 3 1-1h4l1 3 3 1 3 1v4l-2 2 1 3-2 3-3-1-2 3h-4l-1-3-3-1-2-2 1-4-2-2 2-4h3z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
 refresh:'M3 11a9 9 0 0 1 16-5l2 3m0-6v6h-6 M21 13a9 9 0 0 1-16 5l-2-3m0 6v-6h6'
};
export const icon=n=>'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="'+paths[n]+'"/></svg>';
