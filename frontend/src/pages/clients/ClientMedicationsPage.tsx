import React from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Pill, Calendar, Clock } from 'lucide-react';

interface ClientContext {
  client: {
    id: string;
    name: string;
    medications?: any[];
  };
}

export const ClientMedicationsPage: React.FC = () => {
  const navigate = useNavigate();
  const { client } = useOutletContext<ClientContext>();

  const handleAddMedication = () => {
    navigate(`/clients/${client.id}/medications/add`);
  };

  // Mock medications for display
  const medications = client.medications || [
    {
      id: '1',
      name: 'Lisinopril',
      dosage: '10mg',
      frequency: 'Once daily',
      startDate: '2024-01-15',
      status: 'Active'
    },
    {
      id: '2',
      name: 'Metformin',
      dosage: '500mg',
      frequency: 'Twice daily',
      startDate: '2024-02-01',
      status: 'Active'
    }
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Current Medications</h2>
        <Button onClick={handleAddMedication}>
          <Plus size={20} className="mr-2" />
          Add Medication
        </Button>
      </div>

      {/* Medications List */}
      {medications.length > 0 ? (
        <div className="grid gap-4">
          {medications.map(med => (
            <Card key={med.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <Pill className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{med.name}</CardTitle>
                      <p className="text-sm text-gray-600">{med.dosage}</p>
                    </div>
                  </div>
                  <span className={`
                    px-2 py-1 text-xs font-medium rounded-full
                    ${med.status === 'Active' 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-gray-100 text-gray-700'
                    }
                  `}>
                    {med.status}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-6 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <Clock size={16} />
                    <span>{med.frequency}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar size={16} />
                    <span>Started: {new Date(med.startDate).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button size="sm" variant="outline">Edit</Button>
                  <Button size="sm" variant="outline">Discontinue</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <Pill className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-4">No medications recorded</p>
            <Button onClick={handleAddMedication}>
              <Plus size={20} className="mr-2" />
              Add First Medication
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};