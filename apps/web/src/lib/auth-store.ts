let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
