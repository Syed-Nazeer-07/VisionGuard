import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function VehicleDistribution({ data }: { data: { name: string; count: number }[] }) {
  return <figure className="vg-distribution">
    <figcaption className="sr-only">Vehicle counts by observed class</figcaption>
    <ul className="sr-only">
      {data.map(({ name, count }) => <li key={name}>{name} {count.toLocaleString()}</li>)}
    </ul>
    <div className="h-64" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart accessibilityLayer={false} data={data} layout="vertical" margin={{left: 2, right: 12, bottom: 0}}>
          <CartesianGrid stroke="#e6e9e6" horizontal={false}/>
          <XAxis type="number" allowDecimals={false} tick={{fontSize:11,fill:'#536260'}} axisLine={false} tickLine={false}/>
          <YAxis type="category" dataKey="name" width={86} tick={{fontSize:11,fill:'#344541'}} axisLine={false} tickLine={false}/>
          <Tooltip cursor={{fill:'#eff3f0'}}/>
          <Bar dataKey="count" name="Vehicles" fill="#256359" radius={[0,4,4,0]} isAnimationActive={false}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </figure>;
}
