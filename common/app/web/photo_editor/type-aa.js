export const typeAntialias={none:'none',sharp:'sharp',crisp:'crisp',strong:'strong',smooth:'smooth',windowsLcd:'windowsLcd',windows:'windows'};
export function hardenCoverage(data){for(let i=3;i<data.length;i+=4)data[i]=data[i]>=128?255:0;return data;}
